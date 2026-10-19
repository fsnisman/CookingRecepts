"""Проверка основных сценариев CRUD без Docker/PostgreSQL."""
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_recipes.db"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    engine.dispose()


SAMPLE = {
    "title": "Омлет с сыром",
    "description": "Простой, быстрый и сытный завтрак на каждый день.",
    "category": "Завтрак",
    "difficulty": "Легко",
    "prep_time": 5,
    "cook_time": 7,
    "servings": 1,
    "emoji": "🍳",
    "ingredients": [{"name": "Яйца", "amount": "2 шт."}, {"name": "Сыр", "amount": "30 г"}],
    "steps": ["Взбейте яйца.", "Обжарьте и посыпьте сыром."],
}


def test_crud_and_stats(client):
    response = client.post("/api/recipes", json=SAMPLE)
    assert response.status_code == 201
    recipe_id = response.json()["id"]
    assert client.get(f"/api/recipes/{recipe_id}").json()["title"] == SAMPLE["title"]
    assert client.get("/api/stats").json() == {"total": 1, "categories": 1, "quick": 1}

    updated = {**SAMPLE, "title": "Омлет с томатами", "category": "Ужин"}
    response = client.put(f"/api/recipes/{recipe_id}", json=updated)
    assert response.status_code == 200
    assert response.json()["title"] == "Омлет с томатами"
    assert len(client.get("/api/recipes?search=томатами&category=Ужин").json()) == 1
    assert client.get("/api/recipes?category=Завтрак").json() == []

    assert client.delete(f"/api/recipes/{recipe_id}").status_code == 204
    assert client.get(f"/api/recipes/{recipe_id}").status_code == 404
    assert client.put(f"/api/recipes/{recipe_id}", json=SAMPLE).status_code == 404
    assert client.delete(f"/api/recipes/{recipe_id}").status_code == 404


def test_validation(client):
    invalid = {**SAMPLE, "title": "", "servings": -1, "ingredients": []}
    response = client.post("/api/recipes", json=invalid)
    assert response.status_code == 422
    assert len(response.json()["detail"]) >= 3
    assert client.get("/api/recipes?sort=unknown").status_code == 422
    assert client.get("/api/recipes?category=unknown").status_code == 422


def test_sort_and_filter(client):
    client.post("/api/recipes", json=SAMPLE)
    client.post("/api/recipes", json={**SAMPLE, "title": "Пирог с яблоками", "category": "Десерт", "cook_time": 50})
    response = client.get("/api/recipes?sort=fast&difficulty=Легко")
    assert response.status_code == 200
    assert [recipe["title"] for recipe in response.json()] == ["Омлет с сыром", "Пирог с яблоками"]
