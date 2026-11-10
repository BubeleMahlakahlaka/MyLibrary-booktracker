(function () {
  "use strict";

  const STORAGE_KEY = "mylib:data:v1";

  const STATUS_LABELS = {
    want: "Want to read",
    reading: "Reading",
    finished: "Finished",
    dnf: "Did not finish",
  };

  const COVER_PALETTE = [
    "#2E4635",
    "#8A3B2E",
    "#4A5245",
    "#B58A3D",
    "#3E5B48",
    "#5C3A21",
  ];

  const state = {
    books: [],
    reflections: [],
    view: "library",
    activeBookId: null,
    filterStatus: "all",
    searchQuery: "",
    editingBookId: null,
    detailTab: "notes",
  };

  let toastTimer;
  let saveFailed = false;

  // All application data is stored together in the browser.
  // localStorage is synchronous, so a successful setItem is written immediately.
  function persistData() {
    try {
      const payload = {
        version: 1,
        savedAt: Date.now(),
        books: state.books,
        reflections: state.reflections,
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      saveFailed = false;
      return true;
    } catch (error) {
      saveFailed = true;
      console.error("MyLib could not save its data:", error);

      if (error && error.name === "QuotaExceededError") {
        showToast("Storage is full. Export a backup and remove some data.");
      } else {
        showToast("Could not save. Check browser storage permissions.");
      }
      return false;
    }
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        state.books = [];
        state.reflections = [];
        return;
      }

      const data = JSON.parse(raw);

      if (!data || typeof data !== "object") {
        throw new Error("Saved data has an invalid format.");
      }

      state.books = Array.isArray(data.books)
        ? data.books.filter(isValidBook).map(normalizeBook)
        : [];

      state.reflections = Array.isArray(data.reflections)
        ? data.reflections.filter(isValidReflection).map(normalizeReflection)
        : [];

      state.books.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      state.reflections.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch (error) {
      console.error("MyLib could not read saved data:", error);
      showToast(
        "Saved data could not be read. Your browser data was not overwritten.",
      );
      state.books = [];
      state.reflections = [];
    }
  }

  function isValidBook(book) {
    return (
      book &&
      typeof book === "object" &&
      typeof book.id === "string" &&
      typeof book.title === "string" &&
      typeof book.author === "string"
    );
  }

  function normalizeBook(book) {
    const totalPages = Math.max(0, Number.parseInt(book.totalPages, 10) || 0);
    const currentPage = Math.max(0, Number.parseInt(book.currentPage, 10) || 0);

    return {
      ...book,
      description: typeof book.description === "string" ? book.description : "",
      coverUrl: safeCoverUrl(book.coverUrl),
      genre: typeof book.genre === "string" ? book.genre : "",
      totalPages,
      currentPage: totalPages ? Math.min(currentPage, totalPages) : currentPage,
      rating: Math.min(5, Math.max(0, Number.parseInt(book.rating, 10) || 0)),
      status: STATUS_LABELS[book.status] ? book.status : "want",
      notes: Array.isArray(book.notes) ? book.notes.filter(isValidEntry) : [],
      quotes: Array.isArray(book.quotes)
        ? book.quotes.filter(isValidEntry)
        : [],
      createdAt: Number(book.createdAt) || Date.now(),
      updatedAt: Number(book.updatedAt) || Date.now(),
    };
  }

  function isValidEntry(entry) {
    return (
      entry &&
      typeof entry === "object" &&
      typeof entry.id === "string" &&
      typeof entry.text === "string"
    );
  }

  function isValidReflection(reflection) {
    return (
      reflection &&
      typeof reflection === "object" &&
      typeof reflection.id === "string" &&
      typeof reflection.text === "string"
    );
  }

  function normalizeReflection(reflection) {
    return {
      id: reflection.id,
      text: reflection.text,
      createdAt: Number(reflection.createdAt) || Date.now(),
    };
  }

  // Utilities
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = value == null ? "" : String(value);
    return element.innerHTML;
  }

  function safeCoverUrl(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value.trim());
      return url.protocol === "https:" || url.protocol === "http:"
        ? url.href
        : "";
    } catch {
      return "";
    }
  }

  function colorForTitle(title) {
    let sum = 0;
    for (let i = 0; i < title.length; i++) sum += title.charCodeAt(i);
    return COVER_PALETTE[sum % COVER_PALETTE.length];
  }

  function initials(title) {
    return String(title || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0] || "")
      .join("")
      .toUpperCase();
  }

  function formatDate(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function debounce(callback, delay) {
    let timer;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback(...args), delay);
    };
  }

  function coverStyle(book) {
    const url = safeCoverUrl(book.coverUrl);
    if (url) {
      // The URL is validated as HTTP(S) before it is placed in a CSS declaration.
      const escapedUrl = url.replace(/["\\\n\r]/g, "");
      return `background-image: url("${escapedUrl}")`;
    }
    return `background: ${colorForTitle(book.title)}`;
  }

  function matchesSearch(book, query) {
    if (!query) return true;
    const needle = query.toLocaleLowerCase();

    const fields = [
      book.title,
      book.author,
      book.description,
      book.genre,
      ...(book.notes || []).map((note) => note.text),
      ...(book.quotes || []).map((quote) => quote.text),
    ];

    return fields.some(
      (field) =>
        typeof field === "string" && field.toLocaleLowerCase().includes(needle),
    );
  }

  // Library shelf
  function renderShelf() {
    const grid = document.getElementById("shelfGrid");
    const empty = document.getElementById("emptyState");

    if (state.books.length === 0) {
      grid.innerHTML = "";
      empty.hidden = false;
      return;
    }

    empty.hidden = true;

    const visibleBooks = state.books.filter(
      (book) =>
        (state.filterStatus === "all" || book.status === state.filterStatus) &&
        matchesSearch(book, state.searchQuery),
    );

    if (visibleBooks.length === 0) {
      grid.innerHTML = `<p class="shelf-message" style="grid-column:1/-1;color:var(--ink-soft);font-size:0.9rem;">No books match "${escapeHtml(state.searchQuery)}" in this filter.</p>`;
      return;
    }

    grid.innerHTML = visibleBooks
      .map((book) => {
        const progress =
          book.totalPages > 0
            ? Math.min(
                100,
                Math.round((book.currentPage / book.totalPages) * 100),
              )
            : 0;
        const rating = Math.min(5, Math.max(0, book.rating || 0));
        const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
        const coverInner = book.coverUrl
          ? ""
          : `<div class="book-cover-fallback">${escapeHtml(initials(book.title))}</div>`;

        return `
        <article class="book-card" data-id="${escapeHtml(book.id)}" tabindex="0" role="button"
          aria-label="Open ${escapeHtml(book.title)} by ${escapeHtml(book.author)}">
          <div class="book-cover" style="${coverStyle(book)}">
            <span class="status-flag">${STATUS_LABELS[book.status]}</span>
            ${coverInner}
          </div>
          <div class="book-meta">
            <p class="book-title">${escapeHtml(book.title)}</p>
            <p class="book-author">${escapeHtml(book.author)}</p>
            ${
              book.totalPages > 0
                ? `
              <div class="book-progress-track" role="progressbar"
                aria-label="Reading progress" aria-valuemin="0" aria-valuemax="100"
                aria-valuenow="${progress}">
                <div class="book-progress-fill" style="width:${progress}%"></div>
              </div>`
                : ""
            }
            <div class="book-stars" aria-label="${rating} out of 5 stars">${stars}</div>
          </div>
        </article>`;
      })
      .join("");
  }

  // Book details
  function getActiveBook() {
    return state.books.find((book) => book.id === state.activeBookId) || null;
  }

  function openBookDetail(id) {
    if (!state.books.some((book) => book.id === id)) return;
    state.activeBookId = id;
    state.detailTab = "notes";
    switchView("detail");
    renderDetail();
  }

  function renderDetail() {
    const book = getActiveBook();
    if (!book) {
      switchView("library");
      renderShelf();
      return;
    }

    const cover = document.getElementById("detailCover");
    cover.style.cssText = coverStyle(book);
    cover.textContent = book.coverUrl ? "" : initials(book.title);

    document.getElementById("detailTitle").textContent = book.title;
    document.getElementById("detailAuthor").textContent = book.author;
    const description = document.getElementById("detailDesc");
    description.textContent = book.description || "";
    description.style.display = book.description ? "" : "none";

    const genre = document.getElementById("detailGenre");
    if (genre) {
      genre.textContent = book.genre ? `Genre: ${book.genre}` : "";
      genre.hidden = !book.genre;
    }

    const picker = document.getElementById("starPicker");
    picker.innerHTML = "";
    for (let value = 1; value <= 5; value++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "star-btn" + (value <= (book.rating || 0) ? " filled" : "");
      button.textContent = value <= (book.rating || 0) ? "★" : "☆";
      button.setAttribute(
        "aria-label",
        `Rate ${value} star${value > 1 ? "s" : ""}`,
      );
      button.setAttribute("aria-pressed", String(value === book.rating));
      button.addEventListener("click", () =>
        setRating(book, value === book.rating ? 0 : value),
      );
      picker.appendChild(button);
    }

    document.getElementById("currentPageInput").value = book.currentPage || 0;
    document.getElementById("totalPageInput").value = book.totalPages || "";
    document.getElementById("statusSelect").value = book.status;
    updateProgressBar(book);
    renderTabPanels(book);
  }

  function updateProgressBar(book) {
    const percentage =
      book.totalPages > 0
        ? Math.min(100, Math.round((book.currentPage / book.totalPages) * 100))
        : 0;

    document.getElementById("progressPct").textContent = percentage + "%";
    document.getElementById("progressFill").style.width = percentage + "%";
  }

  function setRating(book, value) {
    book.rating = value;
    book.updatedAt = Date.now();
    if (persistData()) {
      renderDetail();
      renderShelf();
      showToast(value ? `Rated ${value} out of 5` : "Rating cleared");
    }
  }

  function persistProgress() {
    const book = getActiveBook();
    if (!book) return;

    const currentInput = document.getElementById("currentPageInput");
    const totalInput = document.getElementById("totalPageInput");
    const currentRaw = currentInput.value.trim();
    const totalRaw = totalInput.value.trim();

    const current = currentRaw === "" ? 0 : Number(currentRaw);
    const total = totalRaw === "" ? 0 : Number(totalRaw);

    if (
      !Number.isInteger(current) ||
      !Number.isInteger(total) ||
      current < 0 ||
      total < 0
    ) {
      showToast("Pages must be whole numbers of zero or more.");
      renderDetail();
      return;
    }

    if (total > 0 && current > total) {
      showToast("Current page cannot be greater than total pages.");
      currentInput.focus();
      return;
    }

    book.currentPage = current;
    book.totalPages = total;
    book.status = document.getElementById("statusSelect").value;
    book.updatedAt = Date.now();

    if (persistData()) {
      updateProgressBar(book);
      renderShelf();
      showToast("Reading progress saved");
    }
  }

  function renderTabPanels(book) {
    document.getElementById("notesPanel").hidden = state.detailTab !== "notes";
    document.getElementById("quotesPanel").hidden =
      state.detailTab !== "quotes";

    document.querySelectorAll(".detail-tab").forEach((tab) => {
      const active = tab.dataset.tab === state.detailTab;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });

    const notes = (book.notes || []).slice().sort((a, b) => b.date - a.date);
    document.getElementById("noteList").innerHTML = notes.length
      ? notes
          .map(
            (note) => `
        <div class="entry-card" data-entry-id="${escapeHtml(note.id)}">
          <div class="entry-card-top">
            <span class="entry-meta">${formatDate(note.date)}${note.page != null ? " · p. " + note.page : ""}</span>
            <button class="entry-del" type="button" data-remove="note" data-entry-id="${escapeHtml(note.id)}">Remove</button>
          </div>
          <p class="entry-text">${escapeHtml(note.text)}</p>
        </div>`,
          )
          .join("")
      : `<p class="list-empty">No notes yet for this book.</p>`;

    const quotes = (book.quotes || []).slice().sort((a, b) => b.date - a.date);
    document.getElementById("quoteList").innerHTML = quotes.length
      ? quotes
          .map(
            (quote) => `
        <div class="entry-card quote" data-entry-id="${escapeHtml(quote.id)}">
          <div class="entry-card-top">
            <span class="entry-meta">${formatDate(quote.date)}${quote.page != null ? " · p. " + quote.page : ""}</span>
            <button class="entry-del" type="button" data-remove="quote" data-entry-id="${escapeHtml(quote.id)}">Remove</button>
          </div>
          <p class="entry-text">&ldquo;${escapeHtml(quote.text)}&rdquo;</p>
        </div>`,
          )
          .join("")
      : `<p class="list-empty">No quotes saved yet for this book.</p>`;
  }

  function readOptionalPage(inputId, book) {
    const input = document.getElementById(inputId);
    if (!input.value.trim()) return null;

    const page = Number(input.value);
    if (!Number.isInteger(page) || page < 0) {
      showToast("Page number must be a whole number of zero or more.");
      input.focus();
      return undefined;
    }

    if (book.totalPages > 0 && page > book.totalPages) {
      showToast("That page is beyond this book's total page count.");
      input.focus();
      return undefined;
    }
    return page;
  }

  function addEntry(kind) {
    const book = getActiveBook();
    if (!book) return;

    const isNote = kind === "note";
    const textInput = document.getElementById(
      isNote ? "noteText" : "quoteText",
    );
    const pageInputId = isNote ? "notePage" : "quotePage";
    const text = textInput.value.trim();

    if (!text) {
      showToast(
        isNote ? "Write a note before saving." : "Enter a quote before saving.",
      );
      textInput.focus();
      return;
    }

    const page = readOptionalPage(pageInputId, book);
    if (page === undefined) return;

    const field = isNote ? "notes" : "quotes";
    book[field] = book[field] || [];
    book[field].push({ id: uid(), text, page, date: Date.now() });
    book.updatedAt = Date.now();

    if (persistData()) {
      textInput.value = "";
      document.getElementById(pageInputId).value = "";
      renderTabPanels(book);
      showToast(isNote ? "Note added" : "Quote saved");
    }
  }

  function removeEntry(kind, entryId) {
    const book = getActiveBook();
    if (!book || !["note", "quote"].includes(kind)) return;

    const field = kind === "note" ? "notes" : "quotes";
    book[field] = (book[field] || []).filter((entry) => entry.id !== entryId);
    book.updatedAt = Date.now();

    if (persistData()) {
      renderTabPanels(book);
      showToast(kind === "note" ? "Note removed" : "Quote removed");
    }
  }

  // Add/edit book modal
  function openBookModal(book) {
    state.editingBookId = book ? book.id : null;
    document.getElementById("modalTitle").textContent = book
      ? "Edit book"
      : "Add a book";
    document.getElementById("fTitle").value = book ? book.title : "";
    document.getElementById("fAuthor").value = book ? book.author : "";
    document.getElementById("fDesc").value = book ? book.description || "" : "";
    document.getElementById("fCover").value = book ? book.coverUrl || "" : "";
    document.getElementById("fGenre").value = book ? book.genre || "" : "";
    document.getElementById("fPages").value = book ? book.totalPages || "" : "";
    document.getElementById("fStatus").value = book ? book.status : "want";
    document.getElementById("bookModalOverlay").hidden = false;
    document.getElementById("fTitle").focus();
  }

  function closeBookModal() {
    document.getElementById("bookModalOverlay").hidden = true;
    document.getElementById("bookForm").reset();
    state.editingBookId = null;
  }

  function handleBookFormSubmit(event) {
    event.preventDefault();

    const title = document.getElementById("fTitle").value.trim();
    const author = document.getElementById("fAuthor").value.trim();
    const pagesRaw = document.getElementById("fPages").value.trim();
    const pages = pagesRaw === "" ? 0 : Number(pagesRaw);
    const coverInput = document.getElementById("fCover").value.trim();

    if (!title || !author) return;
    if (!Number.isInteger(pages) || pages < 0) {
      showToast("Total pages must be a whole number of zero or more.");
      return;
    }

    const coverUrl = safeCoverUrl(coverInput);
    if (coverInput && !coverUrl) {
      showToast("Cover URL must be a valid HTTP or HTTPS link.");
      return;
    }

    const existing = state.editingBookId
      ? state.books.find((book) => book.id === state.editingBookId)
      : null;

    const book = existing || {
      id: uid(),
      currentPage: 0,
      rating: 0,
      notes: [],
      quotes: [],
      createdAt: Date.now(),
    };

    book.title = title;
    book.author = author;
    book.description = document.getElementById("fDesc").value.trim();
    book.coverUrl = coverUrl;
    book.genre = document.getElementById("fGenre").value.trim();
    book.totalPages = pages;
    book.currentPage =
      pages > 0
        ? Math.min(book.currentPage || 0, pages)
        : book.currentPage || 0;
    book.status = document.getElementById("fStatus").value;
    book.updatedAt = Date.now();

    if (!existing) state.books.unshift(book);

    if (!persistData()) {
      if (!existing)
        state.books = state.books.filter((item) => item.id !== book.id);
      return;
    }

    closeBookModal();
    renderShelf();
    if (state.view === "detail" && state.activeBookId === book.id)
      renderDetail();
    showToast(existing ? "Book updated" : "Book added to your shelf");
  }

  function deleteActiveBook() {
    const book = getActiveBook();
    if (!book) return;

    if (
      !window.confirm(
        `Remove "${book.title}" from your library? This also deletes its notes and quotes.`,
      )
    ) {
      return;
    }

    const previousBooks = state.books;
    state.books = state.books.filter((item) => item.id !== book.id);

    if (!persistData()) {
      state.books = previousBooks;
      return;
    }

    state.activeBookId = null;
    switchView("library");
    renderShelf();
    showToast("Book removed");
  }

  // Reflections
  function renderReflections() {
    const list = document.getElementById("reflectionList");
    const empty = document.getElementById("reflectionsEmpty");

    if (state.reflections.length === 0) {
      list.innerHTML = "";
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    list.innerHTML = state.reflections
      .map(
        (reflection) => `
      <div class="reflection-card">
        <span class="reflection-date">${formatDate(reflection.createdAt)}</span>
        <p class="reflection-text">${escapeHtml(reflection.text)}</p>
        <button class="entry-del" type="button" data-remove-reflection="${escapeHtml(reflection.id)}">Remove</button>
      </div>`,
      )
      .join("");
  }

  function addReflection() {
    const input = document.getElementById("reflectionText");
    const text = input.value.trim();

    if (!text) {
      showToast("Write a reflection before saving.");
      input.focus();
      return;
    }

    const reflection = { id: uid(), text, createdAt: Date.now() };
    state.reflections.unshift(reflection);

    if (persistData()) {
      input.value = "";
      renderReflections();
      showToast("Reflection saved");
    } else {
      state.reflections = state.reflections.filter(
        (item) => item.id !== reflection.id,
      );
    }
  }

  function removeReflection(id) {
    const previous = state.reflections;
    state.reflections = state.reflections.filter(
      (reflection) => reflection.id !== id,
    );

    if (persistData()) {
      renderReflections();
      showToast("Reflection removed");
    } else {
      state.reflections = previous;
    }
  }

  // Backup and restore
  function exportBackup() {
    const backup = {
      app: "MyLib",
      version: 1,
      exportedAt: new Date().toISOString(),
      books: state.books,
      reflections: state.reflections,
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mylib-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Backup exported");
  }

  function importBackup(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (
          !data ||
          !Array.isArray(data.books) ||
          !Array.isArray(data.reflections)
        ) {
          throw new Error("This file is not a valid MyLib backup.");
        }

        const books = data.books.filter(isValidBook).map(normalizeBook);
        const reflections = data.reflections
          .filter(isValidReflection)
          .map(normalizeReflection);

        if (
          !window.confirm(
            `Import ${books.length} book(s) and ${reflections.length} reflection(s)? This replaces the data currently stored in this browser. Export a backup first if you want to keep the current data.`,
          )
        ) {
          event.target.value = "";
          return;
        }

        const previousBooks = state.books;
        const previousReflections = state.reflections;
        state.books = books;
        state.reflections = reflections;

        if (!persistData()) {
          state.books = previousBooks;
          state.reflections = previousReflections;
          return;
        }

        state.activeBookId = null;
        state.searchQuery = "";
        state.filterStatus = "all";
        document.getElementById("searchInput").value = "";
        document.querySelectorAll(".chip").forEach((chip) => {
          chip.classList.toggle("active", chip.dataset.status === "all");
        });
        switchView("library");
        renderShelf();
        showToast("Backup imported");
      } catch (error) {
        console.error("MyLib backup import failed:", error);
        showToast("That file is not a valid MyLib backup.");
      } finally {
        event.target.value = "";
      }
    };

    reader.onerror = () => {
      showToast("Could not read that backup file.");
      event.target.value = "";
    };

    reader.readAsText(file);
  }

  // View switching
  function switchView(view) {
    state.view = view;
    document.getElementById("libraryView").hidden = view !== "library";
    document.getElementById("bookDetailView").hidden = view !== "detail";
    document.getElementById("reflectionsView").hidden = view !== "reflections";

    document.querySelectorAll(".nav-tab").forEach((tab) => {
      const active =
        (view === "reflections" && tab.dataset.nav === "reflections") ||
        (view !== "reflections" && tab.dataset.nav === "library");
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-current", active ? "page" : "false");
    });

    document.getElementById("searchWrap").style.display =
      view === "reflections" ? "none" : "";
  }

  // Event wiring
  function wireEvents() {
    document
      .getElementById("openAddBtn")
      .addEventListener("click", () => openBookModal(null));
    document
      .getElementById("emptyAddBtn")
      .addEventListener("click", () => openBookModal(null));
    document
      .getElementById("cancelModalBtn")
      .addEventListener("click", closeBookModal);

    document
      .getElementById("bookModalOverlay")
      .addEventListener("click", (event) => {
        if (event.target.id === "bookModalOverlay") closeBookModal();
      });

    document
      .getElementById("bookForm")
      .addEventListener("submit", handleBookFormSubmit);

    document.getElementById("searchInput").addEventListener(
      "input",
      debounce((event) => {
        state.searchQuery = event.target.value.trim();
        renderShelf();
      }, 120),
    );

    document.getElementById("filterRow").addEventListener("click", (event) => {
      const chip = event.target.closest(".chip");
      if (!chip) return;
      state.filterStatus = chip.dataset.status;
      document.querySelectorAll(".chip").forEach((item) => {
        item.classList.toggle("active", item === chip);
      });
      renderShelf();
    });

    document.getElementById("shelfGrid").addEventListener("click", (event) => {
      const card = event.target.closest(".book-card");
      if (card) openBookDetail(card.dataset.id);
    });

    document
      .getElementById("shelfGrid")
      .addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const card = event.target.closest(".book-card");
        if (!card) return;
        event.preventDefault();
        openBookDetail(card.dataset.id);
      });

    document.querySelectorAll(".nav-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        if (tab.dataset.nav === "reflections") {
          switchView("reflections");
          renderReflections();
        } else {
          switchView("library");
          renderShelf();
        }
      });
    });

    document.getElementById("backToLibrary").addEventListener("click", () => {
      switchView("library");
      renderShelf();
    });

    document.getElementById("editBookBtn").addEventListener("click", () => {
      const book = getActiveBook();
      if (book) openBookModal(book);
    });
    document
      .getElementById("deleteBookBtn")
      .addEventListener("click", deleteActiveBook);

    document
      .getElementById("currentPageInput")
      .addEventListener("change", persistProgress);
    document
      .getElementById("totalPageInput")
      .addEventListener("change", persistProgress);
    document
      .getElementById("statusSelect")
      .addEventListener("change", persistProgress);

    document.querySelectorAll(".detail-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        state.detailTab = tab.dataset.tab;
        const book = getActiveBook();
        if (book) renderTabPanels(book);
      });
    });

    document
      .getElementById("addNoteBtn")
      .addEventListener("click", () => addEntry("note"));
    document
      .getElementById("addQuoteBtn")
      .addEventListener("click", () => addEntry("quote"));

    document.addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-remove]");
      if (removeButton) {
        removeEntry(removeButton.dataset.remove, removeButton.dataset.entryId);
        return;
      }

      const removeReflectionButton = event.target.closest(
        "[data-remove-reflection]",
      );
      if (removeReflectionButton) {
        removeReflection(removeReflectionButton.dataset.removeReflection);
      }
    });

    document
      .getElementById("addReflectionBtn")
      .addEventListener("click", addReflection);

    const exportButton = document.getElementById("exportBackupBtn");
    if (exportButton) exportButton.addEventListener("click", exportBackup);

    const importInput = document.getElementById("importBackupInput");
    if (importInput) importInput.addEventListener("change", importBackup);

    document.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" &&
        !document.getElementById("bookModalOverlay").hidden
      ) {
        closeBookModal();
      }
    });
  }

  function init() {
    wireEvents();
    loadData();
    renderShelf();
  }

  init();
})();
