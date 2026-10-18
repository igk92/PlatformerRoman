(() => {
  'use strict';

  // ---------- Константы ----------
  const T = 32;              // размер клетки в мировых единицах
  const MIN_VIEW_COLS = 8;   // минимум клеток по ширине экрана (для узких телефонов)
  const MIN_VIEW_ROWS = 10;  // минимум клеток по высоте (для горизонтального экрана)
  const GRAVITY = 1900;
  const MAX_FALL = 900;
  const MOVE_SPEED = 190;
  const ACCEL_GROUND = 2200;
  const ACCEL_AIR = 1300;
  const JUMP_VELOCITY = 680;
  const COYOTE_TIME = 0.1;   // можно прыгнуть чуть позже, чем сошёл с края
  const JUMP_BUFFER = 0.12;  // нажатие прыжка чуть раньше приземления засчитывается
  const PLAYER_W = 24;
  const PLAYER_H = 68;
  const TORSO_H = 50;        // высота фото героя (по пояс)
  const LEG_LEN = 21;        // длина нарисованных ног
  const ITEM_BOX = { w: 30, h: 34 };   // размер предмета на уровне
  const PRIZE_BOX = { w: 30, h: 52 };  // приз крупнее

  // ---------- Telegram ----------
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    if (tg.setHeaderColor) tg.setHeaderColor('#5c94fc');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#3b2a1a');
  }
  const haptic = {
    light() { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred('light'); },
    success() { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success'); },
  };

  // ---------- DOM ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const hudLevel = $('hud-level');
  const hudItems = $('hud-items');
  const dialogEl = $('dialog');
  const dialogAvatar = $('dialog-avatar');
  const dialogName = $('dialog-name');
  const dialogText = $('dialog-text');
  const bannerEl = $('banner');
  const bannerTitle = $('banner-title');
  const bannerText = $('banner-text');
  const bannerBtn = $('banner-btn');

  // ---------- Картинки из конфига ----------
  const images = {};
  function loadImage(key, src) {
    if (!src) return;
    const img = new Image();
    img.onload = () => { images[key] = trimImage(img, 400); };
    img.onerror = () => console.warn('Не удалось загрузить картинку', src);
    img.src = src;
  }

  // Обрезает прозрачные поля и уменьшает картинку до maxSize — так её быстрее рисовать
  function trimImage(img, maxSize) {
    const w = img.naturalWidth, h = img.naturalHeight;
    const src = document.createElement('canvas');
    src.width = w;
    src.height = h;
    const g = src.getContext('2d');
    g.drawImage(img, 0, 0);
    let data;
    try {
      data = g.getImageData(0, 0, w, h).data;
    } catch (e) {
      return img; // например, страница открыта как file:// — рисуем как есть
    }
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 16) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
    }
    if (x1 < 0) return img;
    const tw = x1 - x0 + 1, th = y1 - y0 + 1;
    const k = Math.min(1, maxSize / Math.max(tw, th));
    const out = document.createElement('canvas');
    out.width = Math.round(tw * k);
    out.height = Math.round(th * k);
    const og = out.getContext('2d');
    og.imageSmoothingQuality = 'high';
    og.drawImage(src, x0, y0, tw, th, 0, 0, out.width, out.height);
    return out;
  }

  loadImage('hero', HERO.sprite);
  loadImage('prize', PRIZE.image);
  for (const [type, def] of Object.entries(ITEM_TYPES)) loadImage('item:' + type, def.image);

  dialogName.textContent = HERO.name;
  dialogAvatar.src = HERO.avatar || makeHeroAvatar();

  // ---------- Состояние ----------
  let levelIndex = 0;
  let level = null;   // { grid, cols, rows, width, height, items, start }
  let state = 'play'; // play | dialog | banner
  let time = 0;
  const player = {
    x: 0, y: 0, vx: 0, vy: 0,
    facing: 1, onGround: false, coyote: 0, walkPhase: 0,
  };
  const camera = { x: 0, y: 0 };
  const view = { w: 0, h: 0, scale: 1, dpr: 1 };

  // ---------- Загрузка уровня ----------
  function loadLevel(index) {
    const def = LEVELS[index];
    const rows = def.map.length;
    const cols = Math.max(...def.map.map((r) => r.length));
    const grid = [];
    const items = [];
    let start = { x: T, y: (rows - 3) * T };

    for (let r = 0; r < rows; r++) {
      const line = def.map[r].padEnd(cols, '.');
      const row = [];
      for (let c = 0; c < cols; c++) {
        const ch = line[c];
        if (ch === '#' || ch === '=') {
          row.push(ch);
          continue;
        }
        row.push('.');
        if (ch === 'P') {
          start = { x: c * T + (T - PLAYER_W) / 2, y: (r + 1) * T - PLAYER_H };
        } else if (ch === '*') {
          items.push({ x: c * T, y: r * T, prize: true, message: PRIZE.message, taken: false });
        } else if (/[a-z]/.test(ch)) {
          let info = def.items && def.items[ch];
          if (typeof info === 'string') info = { type: info };
          if (!info) {
            console.warn(`Предмет "${ch}" не описан в items уровня ${index + 1}`);
            continue;
          }
          const typeDef = ITEM_TYPES[info.type] || {};
          items.push({
            x: c * T, y: r * T, type: info.type,
            message: info.message || typeDef.message, taken: false,
          });
        }
      }
      grid.push(row);
    }

    level = { grid, cols, rows, width: cols * T, height: rows * T, items, start };
    respawn();
    resize();
    updateHud();
    snapCamera();
  }

  function respawn() {
    player.x = level.start.x;
    player.y = level.start.y;
    player.vx = 0;
    player.vy = 0;
    player.facing = 1;
  }

  function tileAt(c, r) {
    if (c < 0 || c >= level.cols) return '#'; // края уровня — стена
    if (r < 0 || r >= level.rows) return '.';
    return level.grid[r][c];
  }

  function updateHud() {
    hudLevel.textContent = LEVELS[levelIndex].name || `Уровень ${levelIndex + 1}`;
    const regular = level.items.filter((i) => !i.prize);
    const taken = regular.filter((i) => i.taken).length;
    hudItems.textContent = regular.length ? `🎒 ${taken}/${regular.length}` : '';
  }

  // ---------- Ввод ----------
  const input = { left: false, right: false, jump: false };
  let jumpBuffer = 0;

  function setKey(key, down) {
    if (key === 'jump' && down && !input.jump) jumpBuffer = JUMP_BUFFER;
    input[key] = down;
  }

  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  };

  window.addEventListener('keydown', (e) => {
    if (state !== 'play' && (e.code === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      if (!e.repeat) closeOverlay();
      return;
    }
    const key = KEYMAP[e.code];
    if (key) {
      e.preventDefault();
      setKey(key, true);
    }
  });
  window.addEventListener('keyup', (e) => {
    const key = KEYMAP[e.code];
    if (key) setKey(key, false);
  });

  for (const btn of document.querySelectorAll('.ctrl')) {
    const key = btn.dataset.key;
    const press = (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('active');
      setKey(key, true);
    };
    const release = () => {
      btn.classList.remove('active');
      setKey(key, false);
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Если окно потеряло фокус — отпускаем все кнопки
  window.addEventListener('blur', () => {
    input.left = input.right = input.jump = false;
  });

  // ---------- Физика ----------
  function update(dt) {
    time += dt;
    if (state !== 'play') return;

    // Горизонтальное движение
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const accel = player.onGround ? ACCEL_GROUND : ACCEL_AIR;
    const target = dir * MOVE_SPEED;
    if (player.vx < target) player.vx = Math.min(target, player.vx + accel * dt);
    else if (player.vx > target) player.vx = Math.max(target, player.vx - accel * dt);
    if (dir) player.facing = dir;

    // Прыжок
    jumpBuffer = Math.max(0, jumpBuffer - dt);
    player.coyote = player.onGround ? COYOTE_TIME : Math.max(0, player.coyote - dt);
    if (jumpBuffer > 0 && player.coyote > 0) {
      player.vy = -JUMP_VELOCITY;
      player.coyote = 0;
      jumpBuffer = 0;
      player.onGround = false;
    }
    // Отпустил кнопку раньше — прыжок ниже
    if (!input.jump && player.vy < -JUMP_VELOCITY * 0.45) player.vy = -JUMP_VELOCITY * 0.45;

    player.vy = Math.min(MAX_FALL, player.vy + GRAVITY * dt);

    moveX(player.vx * dt);
    moveY(player.vy * dt);

    if (player.onGround && Math.abs(player.vx) > 10) player.walkPhase += dt * 12;
    else player.walkPhase = 0;

    // Упал в яму
    if (player.y > level.height + 100) respawn();

    checkItems();
  }

  function moveX(dx) {
    player.x += dx;
    const top = Math.floor(player.y / T);
    const bottom = Math.floor((player.y + PLAYER_H - 0.01) / T);
    if (dx > 0) {
      const c = Math.floor((player.x + PLAYER_W) / T);
      for (let r = top; r <= bottom; r++) {
        if (tileAt(c, r) === '#') {
          player.x = c * T - PLAYER_W;
          player.vx = 0;
          break;
        }
      }
    } else if (dx < 0) {
      const c = Math.floor(player.x / T);
      for (let r = top; r <= bottom; r++) {
        if (tileAt(c, r) === '#') {
          player.x = (c + 1) * T;
          player.vx = 0;
          break;
        }
      }
    }
  }

  function moveY(dy) {
    const prevBottom = player.y + PLAYER_H;
    player.y += dy;
    player.onGround = false;
    const left = Math.floor(player.x / T);
    const right = Math.floor((player.x + PLAYER_W - 0.01) / T);

    if (dy > 0) {
      const r = Math.floor((player.y + PLAYER_H) / T);
      for (let c = left; c <= right; c++) {
        const t = tileAt(c, r);
        // Платформа "=" держит только если падаем на неё сверху
        if (t === '#' || (t === '=' && prevBottom <= r * T + 0.01)) {
          player.y = r * T - PLAYER_H;
          player.vy = 0;
          player.onGround = true;
          break;
        }
      }
    } else if (dy < 0) {
      const r = Math.floor(player.y / T);
      for (let c = left; c <= right; c++) {
        if (tileAt(c, r) === '#') {
          player.y = (r + 1) * T;
          player.vy = 0;
          break;
        }
      }
    }
  }

  // Прямоугольник предмета: стоит на дне своей клетки, по центру
  function itemBox(item) {
    const box = item.prize ? PRIZE_BOX : ITEM_BOX;
    return { x: item.x + (T - box.w) / 2, y: item.y + T - box.h, w: box.w, h: box.h };
  }

  function checkItems() {
    for (const item of level.items) {
      if (item.taken) continue;
      // Хитбокс чуть меньше картинки
      const b = itemBox(item);
      const pad = 5;
      if (player.x < b.x + b.w - pad && player.x + PLAYER_W > b.x + pad &&
          player.y < b.y + b.h - pad && player.y + PLAYER_H > b.y + pad) {
        item.taken = true;
        resetInput();
        if (item.prize) {
          haptic.success();
          showDialog(item.message, onPrize);
        } else {
          haptic.light();
          updateHud();
          showDialog(item.message);
        }
        return;
      }
    }
  }

  function resetInput() {
    input.left = input.right = input.jump = false;
    jumpBuffer = 0;
    player.vx = 0;
    for (const b of document.querySelectorAll('.ctrl.active')) b.classList.remove('active');
  }

  // ---------- Диалоги ----------
  let bannerAction = null;
  let dialogAction = null;

  // then — что сделать после закрытия диалога
  function showDialog(text, then) {
    state = 'dialog';
    dialogText.textContent = text || '...';
    dialogAction = then || null;
    dialogEl.classList.remove('hidden');
  }

  function onPrize() {
    const isLast = levelIndex === LEVELS.length - 1;
    if (isLast) {
      showBanner('🏆', 'Победа!', 'Ты прошёл все уровни!', 'Играть снова', () => {
        levelIndex = 0;
        loadLevel(levelIndex);
      });
    } else {
      showBanner('🍺', 'Уровень пройден!', 'Приз найден!', 'Следующий уровень', () => {
        levelIndex++;
        loadLevel(levelIndex);
      });
    }
  }

  function showBanner(icon, title, text, button, action) {
    state = 'banner';
    $('banner-icon').textContent = icon;
    bannerTitle.textContent = title;
    bannerText.textContent = text;
    bannerBtn.textContent = button;
    bannerAction = action;
    bannerEl.classList.remove('hidden');
  }

  function closeOverlay() {
    if (state === 'dialog') {
      dialogEl.classList.add('hidden');
      state = 'play';
      const action = dialogAction;
      dialogAction = null;
      if (action) action();
    } else if (state === 'banner') {
      bannerEl.classList.add('hidden');
      state = 'play';
      const action = bannerAction;
      bannerAction = null;
      if (action) action();
    }
  }

  $('dialog-ok').addEventListener('click', closeOverlay);
  bannerBtn.addEventListener('click', closeOverlay);

  // ---------- Экран и камера ----------
  function resize() {
    const rect = canvas.getBoundingClientRect();
    view.dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * view.dpr);
    canvas.height = Math.round(rect.height * view.dpr);
    if (!level) return;
    view.scale = Math.min(rect.width / (MIN_VIEW_COLS * T), rect.height / (MIN_VIEW_ROWS * T));
    view.w = rect.width / view.scale;
    view.h = rect.height / view.scale;
  }
  window.addEventListener('resize', () => { resize(); snapCamera(); });
  if (tg) tg.onEvent('viewportChanged', () => { resize(); snapCamera(); });

  function cameraTarget() {
    let x = player.x + PLAYER_W / 2 - view.w / 2;
    x = level.width <= view.w ? (level.width - view.w) / 2 : clamp(x, 0, level.width - view.w);
    // Герой чуть ниже центра экрана — так лучше видно платформы сверху
    let y = player.y + PLAYER_H - view.h * 0.65;
    // Если уровень ниже экрана — прижимаем его к низу, сверху будет небо
    y = level.height <= view.h ? level.height - view.h : clamp(y, 0, level.height - view.h);
    return { x, y };
  }

  function snapCamera() {
    const t = cameraTarget();
    camera.x = t.x;
    camera.y = t.y;
  }

  function updateCamera(dt) {
    const t = cameraTarget();
    const k = 1 - Math.exp(-dt * 8);
    camera.x += (t.x - camera.x) * k;
    camera.y += (t.y - camera.y) * k;
  }

  // ---------- Отрисовка ----------
  function render() {
    const k = view.dpr * view.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Небо
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, '#5c94fc');
    sky.addColorStop(1, '#a8d8ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(k, 0, 0, k, -Math.round(camera.x * k), -Math.round(camera.y * k));

    drawBackground();
    drawTiles();
    for (const item of level.items) if (!item.taken) drawItem(item);
    drawPlayer();
  }

  function drawBackground() {
    // Облака и холмы двигаются медленнее — эффект глубины
    const groundY = level.height - 2 * T;
    ctx.save();
    ctx.translate(camera.x * 0.7, camera.y * 0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    // Облака раскиданы по всей высоте уровня
    const cloudRows = Math.max(1, Math.ceil(level.height / 160));
    for (let i = 0; i < 12 * cloudRows; i++) {
      const cx = (i % 12) * 260 + ((i * 7) % 5) * 40 - 100;
      const cy = 40 + Math.floor(i / 12) * 160 + ((i * 3) % 4) * 28;
      cloud(cx, cy * 0.5);
    }
    ctx.restore();

    ctx.save();
    ctx.translate(camera.x * 0.45, 0);
    for (let i = 0; i < 14; i++) {
      const hx = i * 220 + (i % 2) * 60;
      const hr = 70 + (i % 3) * 30;
      ctx.fillStyle = i % 2 ? '#6fbf4a' : '#5aa83a';
      ctx.beginPath();
      ctx.ellipse(hx, groundY + 10, hr * 1.4, hr, 0, Math.PI, 0);
      ctx.fill();
    }
    ctx.restore();
  }

  function cloud(x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.arc(x + 20, y - 10, 22, 0, Math.PI * 2);
    ctx.arc(x + 44, y, 18, 0, Math.PI * 2);
    ctx.rect(x, y, 44, 18);
    ctx.fill();
  }

  function drawTiles() {
    const c0 = Math.max(0, Math.floor(camera.x / T));
    const c1 = Math.min(level.cols - 1, Math.floor((camera.x + view.w) / T));
    const r0 = Math.max(0, Math.floor(camera.y / T));
    const r1 = Math.min(level.rows - 1, Math.floor((camera.y + view.h) / T));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const t = level.grid[r][c];
        const x = c * T, y = r * T;
        if (t === '#') {
          const top = tileAt(c, r - 1) !== '#';
          ctx.fillStyle = '#c7773a';
          ctx.fillRect(x, y, T, T);
          ctx.fillStyle = '#a95f2a';
          ctx.fillRect(x + 4, y + 12, 6, 6);
          ctx.fillRect(x + 20, y + 22, 6, 6);
          ctx.fillRect(x + 16, y + 6, 4, 4);
          if (top) {
            ctx.fillStyle = '#4caf3a';
            ctx.fillRect(x, y, T, 9);
            ctx.fillStyle = '#3d9130';
            ctx.fillRect(x, y + 9, T, 3);
          }
        } else if (t === '=') {
          ctx.fillStyle = '#8b5a2b';
          ctx.fillRect(x, y, T, 12);
          ctx.fillStyle = '#b07a42';
          ctx.fillRect(x, y, T, 4);
          ctx.fillStyle = '#5e3a17';
          ctx.fillRect(x + T - 2, y, 2, 12);
        }
      }
    }
  }

  function drawItem(item) {
    const b = itemBox(item);
    const bob = Math.sin(time * 3 + item.x * 0.05) * 3 - 3;
    const img = item.prize ? images.prize : images['item:' + item.type];

    if (item.prize) {
      // Сияние вокруг приза, чтобы его было видно издалека
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2 + bob;
      const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, 34 + pulse * 6);
      glow.addColorStop(0, 'rgba(255, 240, 120, 0.85)');
      glow.addColorStop(1, 'rgba(255, 240, 120, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(cx - 44, cy - 44, 88, 88);
    }

    if (img) {
      drawImageFit(img, b.x, b.y + bob, b.w, b.h);
    } else if (item.prize) {
      drawStar(b.x + b.w / 2, b.y + b.h - 16 + bob);
    } else {
      drawUnknown(b.x + b.w / 2, b.y + b.h - 14 + bob);
    }
  }

  // Запасная картинка приза, если файл не загрузился
  function drawStar(cx, cy) {
    ctx.save();
    ctx.translate(cx, cy);
    starPath(0, 0, 15, 7);
    ctx.fillStyle = '#ffd400';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#c98a00';
    ctx.stroke();
    ctx.restore();
  }

  function drawUnknown(cx, cy) {
    ctx.fillStyle = '#f39c12';
    ctx.fillRect(cx - 10, cy - 10, 20, 20);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', cx, cy + 1);
  }

  function starPath(cx, cy, outer, inner) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? inner : outer;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  function drawPlayer() {
    const img = images.hero;
    if (!img) {
      drawStickman(ctx, player.x + PLAYER_W / 2, player.y + PLAYER_H - 40, player.facing, player.walkPhase, !player.onGround);
      return;
    }
    const inAir = !player.onGround;
    const swing = inAir ? 0.5 : Math.sin(player.walkPhase) * 0.6;
    const hipY = player.y + PLAYER_H - LEG_LEN;

    ctx.save();
    ctx.translate(player.x + PLAYER_W / 2, hipY);

    // Ноги в черных штанах
    ctx.save();
    ctx.scale(player.facing, 1);
    ctx.fillStyle = '#151515';
    roundRect(ctx, -9, -5, 18, 10, 3);
    ctx.fill();
    drawLeg(-4, inAir ? -0.4 : swing);
    drawLeg(4, inAir ? 0.5 : -swing);
    ctx.restore();

    // Фото по пояс, бёдра (HERO.hipX) — над ногами
    const h = TORSO_H;
    const w = h * (img.width / img.height);
    ctx.scale(HERO.spriteFacesLeft ? -player.facing : player.facing, 1);
    ctx.drawImage(img, -HERO.hipX * w, -h + 3, w, h);
    ctx.restore();
  }

  function drawLeg(x, angle) {
    const ex = x + Math.sin(angle) * LEG_LEN * 0.7;
    const ey = Math.cos(angle) * LEG_LEN - 2;
    ctx.strokeStyle = '#151515';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // Ботинок
    ctx.fillStyle = '#4a2c17';
    roundRect(ctx, ex - 4, ey - 1, 11, 5, 2);
    ctx.fill();
  }

  // Нарисованный человечек. (cx, top) — центр по X и верх фигуры
  function drawStickman(g, cx, top, facing, phase, inAir) {
    const swing = inAir ? 0.6 : Math.sin(phase) * 0.7;
    g.save();
    g.translate(cx, top);
    g.scale(facing, 1);
    g.lineCap = 'round';

    // Ноги
    g.strokeStyle = '#2c3e8f';
    g.lineWidth = 5;
    limb(g, -3, 26, swing, 14);
    limb(g, 3, 26, -swing, 14);
    // Тело
    g.fillStyle = '#e53935';
    roundRect(g, -8, 13, 16, 15, 4);
    g.fill();
    // Руки
    g.strokeStyle = '#f2c09b';
    g.lineWidth = 4;
    limb(g, -6, 16, inAir ? -2.4 : -swing, 11);
    limb(g, 6, 16, inAir ? -2.4 : swing, 11);
    drawHead(g, 0, 7, 8);
    g.restore();
  }

  function drawHead(g, x, y, r) {
    g.fillStyle = '#f2c09b';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    // Кепка
    g.fillStyle = '#e53935';
    g.beginPath();
    g.arc(x, y - 1, r, Math.PI, 0);
    g.fill();
    g.fillRect(x, y - 2, r + 4, r * 0.3);
    // Глаз
    g.fillStyle = '#222';
    g.beginPath();
    g.arc(x + r * 0.4, y + r * 0.15, r * 0.14, 0, Math.PI * 2);
    g.fill();
    // Улыбка
    g.strokeStyle = '#222';
    g.lineWidth = Math.max(1, r * 0.12);
    g.beginPath();
    g.arc(x + r * 0.3, y + r * 0.35, r * 0.3, 0.2, Math.PI * 0.8);
    g.stroke();
  }

  function limb(g, x, y, angle, len) {
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.sin(angle) * len * 0.5, y + Math.cos(angle) * len);
    g.stroke();
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // Вписывает картинку в прямоугольник: по центру по горизонтали, прижата к низу
  function drawImageFit(img, x, y, w, h) {
    const s = Math.min(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + h - dh, dw, dh);
  }

  // Аватар для диалога, пока нет фото
  function makeHeroAvatar() {
    const c = document.createElement('canvas');
    c.width = c.height = 168;
    const g = c.getContext('2d');
    g.fillStyle = '#8fd3ff';
    g.fillRect(0, 0, 168, 168);
    g.translate(84, 0);
    g.scale(4, 4);
    drawStickman(g, 0, 5, 1, 0, false);
    return c.toDataURL();
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  // ---------- Игровой цикл ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    updateCamera(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ?level=2 — начать сразу со второго уровня, ?debug — доступ к игре из консоли
  const params = new URLSearchParams(location.search);
  const startLevel = parseInt(params.get('level'), 10);
  if (startLevel >= 1 && startLevel <= LEVELS.length) levelIndex = startLevel - 1;
  if (params.has('debug')) {
    window.game = {
      player, input, setKey,
      get level() { return level; },
      get state() { return state; },
      step(seconds) {
        for (let t = 0; t < seconds; t += 1 / 60) update(1 / 60);
        updateCamera(1);
        render();
      },
    };
  }

  loadLevel(levelIndex);
  requestAnimationFrame(frame);
})();
