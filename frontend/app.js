"use strict";

const API = "/api";
const categoryStyles = {
  "Завтрак": "breakfast", "Обед": "lunch", "Ужин": "dinner",
  "Десерт": "dessert", "Закуска": "snack", "Напиток": "drink"
};
const difficultyStyles = { "Легко": "", "Средне": "medium", "Сложно": "hard" };
const state = {
  recipes: [], category: "", difficulty: "", search: "", sort: "newest",
  favoritesOnly: false, editingId: null, requestId: 0, favorites: new Set()
};

try {
  const ids = JSON.parse(localStorage.getItem("vkusno-favorites") || "[]");
  if (Array.isArray(ids)) state.favorites = new Set(ids.map(Number).filter(Number.isInteger));
} catch { /* Повреждённые локальные настройки не мешают работе приложения. */ }

const byId = (id) => document.getElementById(id);
const detailDialog = byId("recipeDialog");
const editorDialog = byId("editorDialog");
const form = byId("recipeForm");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function toast(message, error = false) {
  const element = byId("toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 3200);
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
    });
  } catch {
    throw new Error("Не удалось связаться с сервером. Проверьте, что Docker-контейнеры запущены.");
  }
  if (!response.ok) {
    let body;
    try { body = await response.json(); } catch { body = {}; }
    const message = typeof body.detail === "string" ? body.detail :
      response.status === 422 ? "Проверьте правильность заполнения полей." :
      `Ошибка сервера (${response.status}).`;
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function minutes(total) {
  if (total < 60) return `${total} мин`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return `${hours} ч${rest ? ` ${rest} мин` : ""}`;
}

function cardHtml(recipe) {
  const title = escapeHtml(recipe.title);
  const style = categoryStyles[recipe.category] || "snack";
  const time = minutes(recipe.prep_time + recipe.cook_time);
  const favorite = state.favorites.has(recipe.id);
  return `
    <article class="recipe-card">
      <div class="recipe-cover cover-${style}" data-action="open" data-id="${recipe.id}" role="button" tabindex="0" aria-label="Посмотреть рецепт ${title}">
        <span class="cover-tag">${escapeHtml(recipe.category)}</span>
        <span class="cover-emoji" aria-hidden="true">${escapeHtml(recipe.emoji)}</span>
        <button type="button" class="favorite-button ${favorite ? "is-favorite" : ""}" data-action="favorite" data-id="${recipe.id}" aria-label="${favorite ? "Удалить из избранного" : "Добавить в избранное"}" title="Избранное">${favorite ? "♥" : "♡"}</button>
      </div>
      <div class="recipe-info">
        <div class="recipe-time">◷ &nbsp;${time} <span aria-hidden="true">·</span> ${recipe.servings} порц.</div>
        <h3 class="recipe-name">${title}</h3>
        <p class="recipe-description">${escapeHtml(recipe.description)}</p>
        <div class="recipe-footer">
          <span class="difficulty ${difficultyStyles[recipe.difficulty] || ""}">✳ ${escapeHtml(recipe.difficulty)}</span>
          <button type="button" class="details-link" data-action="open" data-id="${recipe.id}">Смотреть рецепт ↗</button>
        </div>
      </div>
    </article>`;
}

function renderRecipes() {
  const filtered = state.favoritesOnly
    ? state.recipes.filter((recipe) => state.favorites.has(recipe.id))
    : state.recipes;
  byId("recipeGrid").innerHTML = filtered.map(cardHtml).join("");
  byId("emptyState").hidden = filtered.length > 0;
  const count = filtered.length;
  byId("resultsCount").textContent = `Найдено рецептов: ${count}`;
}

async function refresh() {
  const requestId = ++state.requestId;
  const query = new URLSearchParams({ sort: state.sort });
  if (state.search) query.set("search", state.search);
  if (state.category) query.set("category", state.category);
  if (state.difficulty) query.set("difficulty", state.difficulty);
  try {
    const recipes = await api(`/recipes?${query}`);
    if (requestId !== state.requestId) return;
    state.recipes = recipes;
    renderRecipes();
  } catch (error) {
    if (requestId !== state.requestId) return;
    byId("recipeGrid").innerHTML = "";
    byId("emptyState").hidden = false;
    byId("resultsCount").textContent = "Не удалось загрузить рецепты";
    toast(error.message, true);
  }
  try {
    const stats = await api("/stats");
    byId("statTotal").textContent = stats.total;
    byId("statCategories").textContent = stats.categories;
    byId("statQuick").textContent = stats.quick;
  } catch { /* Поиск рецептов работает даже при недоступной статистике. */ }
}

function updateChips() {
  document.querySelectorAll("[data-category]").forEach((button) => {
    const active = button.dataset.category === state.category;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  byId("favoritesFilter").classList.toggle("active", state.favoritesOnly);
  byId("favoritesFilter").setAttribute("aria-pressed", String(state.favoritesOnly));
}

function resetFilters() {
  state.category = "";
  state.difficulty = "";
  state.search = "";
  state.sort = "newest";
  state.favoritesOnly = false;
  byId("searchInput").value = "";
  byId("difficultySelect").value = "";
  byId("sortSelect").value = "newest";
  updateChips();
  refresh();
}

async function openDetails(id) {
  try {
    const recipe = await api(`/recipes/${id}`);
    const ingredientRows = recipe.ingredients.map(({ name, amount }) => `
      <li><span>${escapeHtml(name)}</span><strong>${escapeHtml(amount)}</strong></li>`).join("");
    const steps = recipe.steps.map((step, index) => `
      <li><span class="step-index">${index + 1}</span><span>${escapeHtml(step)}</span></li>`).join("");
    byId("recipeDialogContent").innerHTML = `
      <div class="detail-cover cover-${categoryStyles[recipe.category] || "snack"}">
        <span class="cover-emoji" aria-hidden="true">${escapeHtml(recipe.emoji)}</span>
        <button type="button" class="icon-button modal-close" data-close="detail" aria-label="Закрыть">×</button>
      </div>
      <div class="detail-body">
        <div class="detail-category">✦ ${escapeHtml(recipe.category)} · ${escapeHtml(recipe.difficulty)}</div>
        <h2 class="detail-title">${escapeHtml(recipe.title)}</h2>
        <p class="detail-description">${escapeHtml(recipe.description)}</p>
        <div class="detail-quickfacts">
          <span>◷ Подготовка: ${minutes(recipe.prep_time)}</span>
          <span>♨ Приготовление: ${minutes(recipe.cook_time)}</span>
          <span>♟ Порций: ${recipe.servings}</span>
        </div>
        <h3>Ингредиенты</h3><ul class="ingredient-list">${ingredientRows}</ul>
        <h3>Как приготовить</h3><ol class="steps-list">${steps}</ol>
        <div class="detail-actions">
          <button class="button button-danger" data-action="delete" data-id="${recipe.id}" type="button">Удалить</button>
          <button class="button button-outline" data-action="edit" data-id="${recipe.id}" type="button">✎ Редактировать</button>
          <button class="button button-primary" data-close="detail" type="button">Готово ✓</button>
        </div>
      </div>`;
    detailDialog.showModal();
  } catch (error) { toast(error.message, true); }
}

function ingredientRow(name = "", amount = "") {
  const row = document.createElement("div");
  row.className = "repeater-row ingredient-row";
  row.innerHTML = `
    <input class="ingredient-name" aria-label="Название ингредиента" placeholder="Например, мука" maxlength="100" required value="${escapeHtml(name)}">
    <input class="amount-input ingredient-amount" aria-label="Количество ингредиента" placeholder="200 г" maxlength="60" required value="${escapeHtml(amount)}">
    <button type="button" class="remove-row" data-remove-row aria-label="Удалить ингредиент" title="Удалить">×</button>`;
  byId("ingredientRows").appendChild(row);
}

function stepRow(text = "") {
  const row = document.createElement("div");
  row.className = "repeater-row step-row";
  row.innerHTML = `
    <textarea class="step-input" aria-label="Шаг приготовления" placeholder="Опиши шаг приготовления" maxlength="600" rows="2" required>${escapeHtml(text)}</textarea>
    <button type="button" class="remove-row" data-remove-row aria-label="Удалить шаг" title="Удалить">×</button>`;
  byId("stepRows").appendChild(row);
}

function openEditor(recipe = null) {
  state.editingId = recipe ? recipe.id : null;
  form.reset();
  byId("editorTitle").textContent = recipe ? "Редактировать рецепт" : "Новый рецепт";
  byId("saveRecipe").textContent = recipe ? "Сохранить изменения →" : "Сохранить рецепт →";
  byId("ingredientRows").replaceChildren();
  byId("stepRows").replaceChildren();
  if (recipe) {
    ["title", "description", "category", "difficulty", "emoji", "prep_time", "cook_time", "servings"].forEach((key) => {
      form.elements.namedItem(key).value = recipe[key];
    });
    recipe.ingredients.forEach((item) => ingredientRow(item.name, item.amount));
    recipe.steps.forEach(stepRow);
  } else {
    ingredientRow(); ingredientRow();
    stepRow(); stepRow();
  }
  editorDialog.showModal();
  byId("recipeTitle").focus();
}

async function editRecipe(id) {
  try {
    const recipe = await api(`/recipes/${id}`);
    if (detailDialog.open) detailDialog.close();
    openEditor(recipe);
  } catch (error) { toast(error.message, true); }
}

async function deleteRecipe(id) {
  if (!window.confirm("Удалить рецепт? Это действие нельзя отменить.")) return;
  try {
    await api(`/recipes/${id}`, { method: "DELETE" });
    state.favorites.delete(id);
    localStorage.setItem("vkusno-favorites", JSON.stringify([...state.favorites]));
    if (detailDialog.open) detailDialog.close();
    toast("Рецепт удалён");
    await refresh();
  } catch (error) { toast(error.message, true); }
}

function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  try { localStorage.setItem("vkusno-favorites", JSON.stringify([...state.favorites])); } catch { /* localStorage может быть заблокирован */ }
  renderRecipes();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const values = new FormData(form);
  const ingredients = [...document.querySelectorAll(".ingredient-row")].map((row) => ({
    name: row.querySelector(".ingredient-name").value.trim(),
    amount: row.querySelector(".ingredient-amount").value.trim()
  }));
  const steps = [...document.querySelectorAll(".step-row")].map((row) => row.querySelector(".step-input").value.trim());
  if (!ingredients.length || !steps.length || ingredients.some((item) => !item.name || !item.amount) || steps.some((step) => !step)) {
    toast("Добавьте хотя бы один ингредиент и один шаг приготовления.", true);
    return;
  }
  const payload = {
    title: String(values.get("title")).trim(),
    description: String(values.get("description")).trim(),
    category: values.get("category"), difficulty: values.get("difficulty"),
    emoji: String(values.get("emoji")).trim(),
    prep_time: Number(values.get("prep_time")), cook_time: Number(values.get("cook_time")),
    servings: Number(values.get("servings")), ingredients, steps
  };
  const button = byId("saveRecipe");
  button.disabled = true;
  try {
    const isEdit = state.editingId !== null;
    await api(isEdit ? `/recipes/${state.editingId}` : "/recipes", {
      method: isEdit ? "PUT" : "POST", body: JSON.stringify(payload)
    });
    editorDialog.close();
    state.favoritesOnly = false;
    state.category = "";
    state.difficulty = "";
    state.search = "";
    byId("searchInput").value = "";
    byId("difficultySelect").value = "";
    updateChips();
    toast(isEdit ? "Изменения сохранены!" : "Рецепт добавлен! 🎉");
    await refresh();
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});

byId("addIngredient").addEventListener("click", () => {
  if (document.querySelectorAll(".ingredient-row").length >= 30) return toast("Не больше 30 ингредиентов", true);
  ingredientRow();
});
byId("addStep").addEventListener("click", () => {
  if (document.querySelectorAll(".step-row").length >= 20) return toast("Не больше 20 шагов", true);
  stepRow();
});

byId("recipeForm").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-row]");
  if (!button) return;
  const row = button.closest(".repeater-row");
  if (row.parentElement.children.length <= 1) {
    toast("Должен остаться хотя бы один элемент", true); return;
  }
  row.remove();
});

let searchTimeout;
byId("searchInput").addEventListener("input", (event) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => { state.search = event.target.value.trim(); refresh(); }, 270);
});
byId("difficultySelect").addEventListener("change", (event) => {
  state.difficulty = event.target.value; refresh();
});
byId("sortSelect").addEventListener("change", (event) => {
  state.sort = event.target.value; refresh();
});
byId("categoryRow").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-category]");
  if (chip) { state.category = chip.dataset.category; updateChips(); refresh(); }
});
byId("favoritesFilter").addEventListener("click", () => {
  state.favoritesOnly = !state.favoritesOnly; updateChips(); renderRecipes();
});
byId("resetFilters").addEventListener("click", resetFilters);

document.addEventListener("click", (event) => {
  const closeButton = event.target.closest("[data-close]");
  if (closeButton) {
    (closeButton.dataset.close === "detail" ? detailDialog : editorDialog).close();
    return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  const id = Number(action.dataset.id);
  switch (action.dataset.action) {
    case "new": openEditor(); break;
    case "open": openDetails(id); break;
    case "edit": editRecipe(id); break;
    case "delete": deleteRecipe(id); break;
    case "favorite": toggleFavorite(id); break;
  }
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if ((event.key === "Enter" || event.key === " ") && target.classList?.contains("recipe-cover")) {
    event.preventDefault(); openDetails(Number(target.dataset.id));
  }
});
[detailDialog, editorDialog].forEach((dialog) => dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
}));

refresh();
