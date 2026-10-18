# Платформер — Telegram Mini App

Игрок ищет звезду ⭐ на уровне. Остальные предметы показывают диалог с фото героя и сообщением. Звезда — переход на следующий уровень.

## Структура

```
webapp/            — сама игра (статические файлы, без сборки)
  index.html
  style.css
  config.js        — герой, предметы, уровни, сообщения  ← править здесь
  game.js          — движок
  assets/          — картинки (фото героя, предметов)
bot.py             — бот с кнопкой «Играть»
```

## Локальный запуск

```bash
python3 -m http.server 8080 --directory webapp
```

Открыть http://localhost:8080. Управление: стрелки / A D, прыжок — пробел / ↑ / W.
На телефоне — экранные кнопки.

Полезные параметры: `?level=2` — сразу второй уровень.

## Как поменять картинки

1. Положить файлы в `webapp/assets/` (для фигурки лучше PNG с прозрачным фоном).
2. В `webapp/config.js` прописать пути: `HERO.sprite`, `HERO.avatar`, `ITEM_TYPES.star.image` и т. д.

## Как запустить в Telegram

1. Выложить папку `webapp/` на любой хостинг с HTTPS (например GitHub Pages, Netlify, Vercel).
2. В @BotFather: `/newbot` → получить токен.
3. Либо в BotFather: `/mybots` → бот → Bot Settings → Menu Button → указать URL игры (бот-код не нужен),
   либо запустить `bot.py`:

```bash
pip install -r requirements.txt
BOT_TOKEN=... WEBAPP_URL=https://... python bot.py
```
