"""REST API кулинарного сборника."""
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from .db import Base, engine, get_db
from .models import Recipe
from .schemas import Category, Difficulty, RecipeCreate, RecipeRead
from .seed import seed_recipes


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    with Session(engine) as db:
        seed_recipes(db)
    yield


app = FastAPI(
    title="Кулинарные рецепты API",
    description="Учебный REST API по дисциплине «Проектирование веб-сервисов»",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/api/health", tags=["Сервис"])
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}


@app.get("/api/stats", tags=["Рецепты"])
def stats(db: Session = Depends(get_db)):
    total = db.scalar(select(func.count()).select_from(Recipe)) or 0
    categories = db.scalar(select(func.count(func.distinct(Recipe.category)))) or 0
    quick = db.scalar(
        select(func.count()).select_from(Recipe).where(Recipe.prep_time + Recipe.cook_time <= 30)
    ) or 0
    return {"total": total, "categories": categories, "quick": quick}


@app.get("/api/recipes", response_model=list[RecipeRead], tags=["Рецепты"])
def list_recipes(
    search: str = Query(default="", max_length=120),
    category: Category | None = None,
    difficulty: Difficulty | None = None,
    sort: Literal["newest", "oldest", "title", "fast"] = "newest",
    db: Session = Depends(get_db),
):
    stmt = select(Recipe)
    if search.strip():
        keyword = f"%{search.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Recipe.title).like(keyword), func.lower(Recipe.description).like(keyword)))
    if category:
        stmt = stmt.where(Recipe.category == category)
    if difficulty:
        stmt = stmt.where(Recipe.difficulty == difficulty)
    ordering = {
        "newest": (Recipe.created_at.desc(), Recipe.id.desc()),
        "oldest": (Recipe.created_at.asc(), Recipe.id.asc()),
        "title": (Recipe.title.asc(),),
        "fast": ((Recipe.prep_time + Recipe.cook_time).asc(), Recipe.id.asc()),
    }
    return db.scalars(stmt.order_by(*ordering[sort])).all()


@app.get("/api/recipes/{recipe_id}", response_model=RecipeRead, tags=["Рецепты"])
def get_recipe(recipe_id: int, db: Session = Depends(get_db)):
    recipe = db.get(Recipe, recipe_id)
    if recipe is None:
        raise HTTPException(status_code=404, detail="Рецепт не найден")
    return recipe


@app.post("/api/recipes", response_model=RecipeRead, status_code=status.HTTP_201_CREATED, tags=["Рецепты"])
def create_recipe(payload: RecipeCreate, db: Session = Depends(get_db)):
    recipe = Recipe(**payload.model_dump())
    db.add(recipe)
    db.commit()
    db.refresh(recipe)
    return recipe


@app.put("/api/recipes/{recipe_id}", response_model=RecipeRead, tags=["Рецепты"])
def update_recipe(recipe_id: int, payload: RecipeCreate, db: Session = Depends(get_db)):
    recipe = db.get(Recipe, recipe_id)
    if recipe is None:
        raise HTTPException(status_code=404, detail="Рецепт не найден")
    for field, value in payload.model_dump().items():
        setattr(recipe, field, value)
    db.commit()
    db.refresh(recipe)
    return recipe


@app.delete("/api/recipes/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Рецепты"])
def delete_recipe(recipe_id: int, db: Session = Depends(get_db)):
    recipe = db.get(Recipe, recipe_id)
    if recipe is None:
        raise HTTPException(status_code=404, detail="Рецепт не найден")
    db.delete(recipe)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
