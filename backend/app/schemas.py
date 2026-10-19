"""Валидация данных API."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Category = Literal["Завтрак", "Обед", "Ужин", "Десерт", "Закуска", "Напиток"]
Difficulty = Literal["Легко", "Средне", "Сложно"]


class Ingredient(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    amount: str = Field(min_length=1, max_length=60)

    @field_validator("name", "amount")
    @classmethod
    def strip_nonempty(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Поле не может быть пустым")
        return value


class RecipeBase(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=10, max_length=600)
    category: Category
    difficulty: Difficulty
    prep_time: int = Field(ge=0, le=1440)
    cook_time: int = Field(ge=0, le=1440)
    servings: int = Field(ge=1, le=50)
    emoji: str = Field(min_length=1, max_length=6)
    ingredients: list[Ingredient] = Field(min_length=1, max_length=30)
    steps: list[str] = Field(min_length=1, max_length=20)

    @field_validator("title", "description", "emoji")
    @classmethod
    def trim_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Поле не может быть пустым")
        return value

    @field_validator("steps")
    @classmethod
    def nonempty_steps(cls, value: list[str]) -> list[str]:
        cleaned = [step.strip() for step in value]
        if any(not step or len(step) > 600 for step in cleaned):
            raise ValueError("Каждый шаг должен содержать от 1 до 600 символов")
        return cleaned


class RecipeCreate(RecipeBase):
    pass


class RecipeRead(RecipeBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
