"""
Минимальный Telegram-бот: на /start присылает кнопку, открывающую игру.

Запуск:
    pip install -r requirements.txt
    BOT_TOKEN=123:abc WEBAPP_URL=https://<твой-хостинг>/ python bot.py
"""
import asyncio
import os

from aiogram import Bot, Dispatcher
from aiogram.filters import CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    MenuButtonWebApp,
    Message,
    WebAppInfo,
)

BOT_TOKEN = os.environ["BOT_TOKEN"]
WEBAPP_URL = os.environ["WEBAPP_URL"]  # обязательно https://

dp = Dispatcher()


@dp.message(CommandStart())
async def start(message: Message) -> None:
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="🎮 Играть", web_app=WebAppInfo(url=WEBAPP_URL))]]
    )
    await message.answer("Найди звезду на каждом уровне! ⭐", reply_markup=keyboard)


async def main() -> None:
    bot = Bot(BOT_TOKEN)
    # Кнопка «Играть» слева от поля ввода сообщения
    await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Играть", web_app=WebAppInfo(url=WEBAPP_URL)))
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
