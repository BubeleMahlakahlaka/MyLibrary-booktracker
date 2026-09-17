(function () {
  "use strict";

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

  //Storage helpers
  async function storageGet(key) {
    try {
      const res = await window.storage.get(key, false);
      return res ? res.value : null;
    } catch (e) {
      return null;
    }
  }
  async function storageSet(key, value) {
    try {
      return await window.storage.set(key, value, false);
    } catch (e) {
      console.error("storage set failed", e);
      return null;
    }
  }
  async function storageDelete(key) {
    try {
      return await window.storage.delete(key, false);
    } catch (e) {
      console.error("storage delete failed", e);
      return null;
    }
  }
  async function storageListKeys(prefix) {
    try {
      const res = await window.storage.list(prefix, false);
      return res && res.keys ? res.keys : [];
    } catch (e) {
      return [];
    }
  }

  async function loadBooks() {
    const keys = await storageListKeys("book:");
    const values = await Promise.all(keys.map((k) => storageGet(k)));
    state.books = values
      .filter(Boolean)
      .map((v) => {
        try {
          return JSON.parse(v);
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);
    state.books.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  async function loadReflections() {
    const keys = await storageListKeys("reflection:");
    const values = await Promise.all(keys.map((k) => storageGet(k)));
    state.reflections = values
      .filter(Boolean)
      .map((v) => {
        try {
          return JSON.parse(v);
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);
    state.reflections.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  function saveBook(book) {
    return storageSet("book:" + book.id, JSON.stringify(book));
  }
  function saveReflection(r) {
    return storageSet("reflection:" + r.id, JSON.stringify(r));
  }

  //Utilities
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str == null ? "" : str;
    return d.innerHTML;
  }
  function colorForTitle(title) {
    let sum = 0;
    for (let i = 0; i < title.length; i++) sum += title.charCodeAt(i);
    return COVER_PALETTE[sum % COVER_PALETTE.length];
  }
  function initials(title) {
    return title
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }
  function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => t.classList.remove("show"), 2200);
  }
  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function coverStyle(book) {
    if (book.coverUrl)
      return `background-image:url('${book.coverUrl.replace(/'/g, "")}')`;
    return `background:${colorForTitle(book.title)}`;
  }

  function matchesSearch(book, q) {
    if (!q) return true;
    q = q.toLowerCase();
    const haystacks = [
      book.title,
      book.author,
      book.description,
      book.genre,
      ...(book.notes || []).map((n) => n.text),
      ...(book.quotes || []).map((n) => n.text),
    ];
    return haystacks.some((h) => h && h.toLowerCase().includes(q));
  }

  //Rendering: shelf
  function renderShelf() {
    const grid = document.getElementById("shelfGrid");
    const empty = document.getElementById("emptyState");
    let list = state.books.filter(
      (b) =>
        (state.filterStatus === "all" || b.status === state.filterStatus) &&
        matchesSearch(b, state.searchQuery),
    );

    if (state.books.length === 0) {
      grid.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    if (list.length === 0) {
      grid.innerHTML = `<p style="grid-column:1/-1;color:var(--ink-soft);font-size:0.9rem;">No books match "${escapeHtml(state.searchQuery)}".</p>`;
      return;
    }

    grid.innerHTML = list
      .map((book) => {
        const pct =
          book.totalPages > 0
            ? Math.min(
                100,
                Math.round((book.currentPage / book.totalPages) * 100),
              )
            : 0;
        const stars =
          "★".repeat(book.rating || 0) + "☆".repeat(5 - (book.rating || 0));
        const coverInner = book.coverUrl
          ? ""
          : `<div class="book-cover-fallback">${escapeHtml(initials(book.title))}</div>`;
        return `
        <div class="book-card" data-id="${book.id}">
          <div class="book-cover" style="${coverStyle(book)}">
            <span class="status-flag">${STATUS_LABELS[book.status]}</span>
            ${coverInner}
          </div>
          <div class="book-meta">
            <p class="book-title">${escapeHtml(book.title)}</p>
            <p class="book-author">${escapeHtml(book.author)}</p>
            <div class="book-progress-track"><div class="book-progress-fill" style="width:${pct}%"></div></div>
            <div class="book-stars">${stars}</div>
          </div>
        </div>`;
      })
      .join("");
  }

  //Book detail
  function openBookDetail(id) {
    state.activeBookId = id;
    state.detailTab = "notes";
    switchView("detail");
    renderDetail();
  }

  function getActiveBook() {
    return state.books.find((b) => b.id === state.activeBookId);
  }

  function renderDetail() {
    const book = getActiveBook();
    if (!book) return;

    const cover = document.getElementById("detailCover");
    cover.style.cssText = coverStyle(book);
    cover.textContent = book.coverUrl ? "" : initials(book.title);

    document.getElementById("detailTitle").textContent = book.title;
    document.getElementById("detailAuthor").textContent = book.author;
    document.getElementById("detailDesc").textContent = book.description || "";
    document.getElementById("detailDesc").style.display = book.description
      ? ""
      : "none";

    // stars
    const picker = document.getElementById("starPicker");
    picker.innerHTML = "";
    for (let i = 1; i <= 5; i++) {
      const btn = document.createElement("button");
      btn.className = "star-btn" + (i <= (book.rating || 0) ? " filled" : "");
      btn.textContent = i <= (book.rating || 0) ? "★" : "☆";
      btn.setAttribute("aria-label", `Rate ${i} star${i > 1 ? "s" : ""}`);
      btn.addEventListener("click", () =>
        setRating(book, i === book.rating ? 0 : i),
      );
      picker.appendChild(btn);
    }

    // progress
    document.getElementById("currentPageInput").value = book.currentPage || 0;
    document.getElementById("totalPageInput").value = book.totalPages || "";
    document.getElementById("statusSelect").value = book.status;
    updateProgressBar(book);

    renderTabPanels(book);
  }

  function updateProgressBar(book) {
    const pct =
      book.totalPages > 0
        ? Math.min(100, Math.round((book.currentPage / book.totalPages) * 100))
        : 0;
    document.getElementById("progressPct").textContent = pct + "%";
    document.getElementById("progressFill").style.width = pct + "%";
  }

  async function setRating(book, value) {
    book.rating = value;
    book.updatedAt = Date.now();
    await saveBook(book);
    renderDetail();
    renderShelf();
  }

  async function persistProgress() {
    const book = getActiveBook();
    if (!book) return;
    const cur =
      parseInt(document.getElementById("currentPageInput").value, 10) || 0;
    const total =
      parseInt(document.getElementById("totalPageInput").value, 10) || 0;
    const status = document.getElementById("statusSelect").value;
    book.currentPage = Math.max(0, cur);
    book.totalPages = Math.max(0, total);
    book.status = status;
    book.updatedAt = Date.now();
    await saveBook(book);
    updateProgressBar(book);
    renderShelf();
  }

  function renderTabPanels(book) {
    document.getElementById("notesPanel").hidden = state.detailTab !== "notes";
    document.getElementById("quotesPanel").hidden =
      state.detailTab !== "quotes";
    document
      .querySelectorAll(".detail-tab")
      .forEach((t) =>
        t.classList.toggle("active", t.dataset.tab === state.detailTab),
      );

    const noteList = document.getElementById("noteList");
    const notes = (book.notes || []).slice().sort((a, b) => b.date - a.date);
    noteList.innerHTML = notes.length
      ? notes
          .map(
            (n) => `
      <div class="entry-card" data-entry-id="${n.id}" data-kind="note">
        <div class="entry-card-top">
          <span class="entry-meta">${formatDate(n.date)}${n.page ? " · p. " + n.page : ""}</span>
          <button class="entry-del" data-remove="note" data-entry-id="${n.id}">Remove</button>
        </div>
        <p class="entry-text">${escapeHtml(n.text)}</p>
      </div>`,
          )
          .join("")
      : `<p style="color:var(--ink-soft);font-size:0.88rem;">No notes yet for this book.</p>`;

    const quoteList = document.getElementById("quoteList");
    const quotes = (book.quotes || []).slice().sort((a, b) => b.date - a.date);
    quoteList.innerHTML = quotes.length
      ? quotes
          .map(
            (q) => `
      <div class="entry-card quote" data-entry-id="${q.id}" data-kind="quote">
        <div class="entry-card-top">
          <span class="entry-meta">${formatDate(q.date)}${q.page ? " · p. " + q.page : ""}</span>
          <button class="entry-del" data-remove="quote" data-entry-id="${q.id}">Remove</button>
        </div>
        <p class="entry-text">&ldquo;${escapeHtml(q.text)}&rdquo;</p>
      </div>`,
          )
          .join("")
      : `<p style="color:var(--ink-soft);font-size:0.88rem;">No quotes saved yet for this book.</p>`;
  }

  async function addNote() {
    const book = getActiveBook();
    const textEl = document.getElementById("noteText");
    const pageEl = document.getElementById("notePage");
    const text = textEl.value.trim();
    if (!text) return;
    book.notes = book.notes || [];
    book.notes.push({
      id: uid(),
      text,
      page: pageEl.value ? parseInt(pageEl.value, 10) : null,
      date: Date.now(),
    });
    book.updatedAt = Date.now();
    await saveBook(book);
    textEl.value = "";
    pageEl.value = "";
    renderTabPanels(book);
    showToast("Note added");
  }

  async function addQuote() {
    const book = getActiveBook();
    const textEl = document.getElementById("quoteText");
    const pageEl = document.getElementById("quotePage");
    const text = textEl.value.trim();
    if (!text) return;
    book.quotes = book.quotes || [];
    book.quotes.push({
      id: uid(),
      text,
      page: pageEl.value ? parseInt(pageEl.value, 10) : null,
      date: Date.now(),
    });
    book.updatedAt = Date.now();
    await saveBook(book);
    textEl.value = "";
    pageEl.value = "";
    renderTabPanels(book);
    showToast("Quote saved");
  }

  async function removeEntry(kind, entryId) {
    const book = getActiveBook();
    if (!book) return;
    const field = kind === "note" ? "notes" : "quotes";
    book[field] = (book[field] || []).filter((e) => e.id !== entryId);
    book.updatedAt = Date.now();
    await saveBook(book);
    renderTabPanels(book);
  }

  //Add / edit book modal
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
    state.editingBookId = null;
  }

  async function handleBookFormSubmit(e) {
    e.preventDefault();
    const title = document.getElementById("fTitle").value.trim();
    const author = document.getElementById("fAuthor").value.trim();
    if (!title || !author) return;

    const existing = state.editingBookId
      ? state.books.find((b) => b.id === state.editingBookId)
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
    book.coverUrl = document.getElementById("fCover").value.trim();
    book.genre = document.getElementById("fGenre").value.trim();
    book.totalPages =
      parseInt(document.getElementById("fPages").value, 10) || 0;
    book.status = document.getElementById("fStatus").value;
    book.updatedAt = Date.now();

    await saveBook(book);
    if (!existing) state.books.unshift(book);

    closeBookModal();
    renderShelf();
    if (state.view === "detail" && state.activeBookId === book.id)
      renderDetail();
    showToast(existing ? "Book updated" : "Book added to your shelf");
  }

  async function deleteActiveBook() {
    const book = getActiveBook();
    if (!book) return;
    if (
      !confirm(
        `Remove "${book.title}" from your library? This deletes its notes and quotes too.`,
      )
    )
      return;
    await storageDelete("book:" + book.id);
    state.books = state.books.filter((b) => b.id !== book.id);
    switchView("library");
    renderShelf();
    showToast("Book removed");
  }

  //Reflections
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
        (r) => `
      <div class="reflection-card" data-id="${r.id}">
        <span class="reflection-date">${formatDate(r.createdAt)}</span>
        <p class="reflection-text">${escapeHtml(r.text)}</p>
        <button class="entry-del" data-remove-reflection="${r.id}">Remove</button>
      </div>
    `,
      )
      .join("");
  }

  async function addReflection() {
    const el = document.getElementById("reflectionText");
    const text = el.value.trim();
    if (!text) return;
    const r = { id: uid(), text, createdAt: Date.now() };
    await saveReflection(r);
    state.reflections.unshift(r);
    el.value = "";
    renderReflections();
    showToast("Reflection saved");
  }

  async function removeReflection(id) {
    await storageDelete("reflection:" + id);
    state.reflections = state.reflections.filter((r) => r.id !== id);
    renderReflections();
  }

  //View switching
  function switchView(view) {
    state.view = view;
    document.getElementById("libraryView").hidden = view !== "library";
    document.getElementById("bookDetailView").hidden = view !== "detail";
    document.getElementById("reflectionsView").hidden = view !== "reflections";
    document.querySelectorAll(".nav-tab").forEach((t) => {
      t.classList.toggle(
        "active",
        (view === "reflections" && t.dataset.nav === "reflections") ||
          (view !== "reflections" && t.dataset.nav === "library"),
      );
    });
    document.getElementById("searchWrap").style.display =
      view === "reflections" ? "none" : "";
  }

  //Event wiring
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
      .addEventListener("click", (e) => {
        if (e.target.id === "bookModalOverlay") closeBookModal();
      });
    document
      .getElementById("bookForm")
      .addEventListener("submit", handleBookFormSubmit);

    document.getElementById("searchInput").addEventListener(
      "input",
      debounce((e) => {
        state.searchQuery = e.target.value;
        renderShelf();
      }, 150),
    );

    document.getElementById("filterRow").addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      state.filterStatus = chip.dataset.status;
      document
        .querySelectorAll(".chip")
        .forEach((c) => c.classList.toggle("active", c === chip));
      renderShelf();
    });

    document.getElementById("shelfGrid").addEventListener("click", (e) => {
      const card = e.target.closest(".book-card");
      if (card) openBookDetail(card.dataset.id);
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
    document
      .getElementById("editBookBtn")
      .addEventListener("click", () => openBookModal(getActiveBook()));
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
        renderTabPanels(getActiveBook());
      });
    });

    document.getElementById("addNoteBtn").addEventListener("click", (e) => {
      e.preventDefault();
      addNote();
    });
    document.getElementById("addQuoteBtn").addEventListener("click", (e) => {
      e.preventDefault();
      addQuote();
    });

    document.addEventListener("click", (e) => {
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        removeEntry(rm.dataset.remove, rm.dataset.entryId);
        return;
      }
      const rmR = e.target.closest("[data-remove-reflection]");
      if (rmR) {
        removeReflection(rmR.dataset.removeReflection);
        return;
      }
    });

    document
      .getElementById("addReflectionBtn")
      .addEventListener("click", addReflection);
  }

  //Init
  async function init() {
    wireEvents();
    await Promise.all([loadBooks(), loadReflections()]);
    renderShelf();
  }

  init();
})();
