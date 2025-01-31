require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

// Инициализация базы данных
const db = new sqlite3.Database('./bot.db', (err) => {
  if (err) {
    console.error('Ошибка подключения к базе данных:', err.message);
  } else {
    console.log('Подключение к базе данных установлено.');
  }
});

// Создаем таблицы, если их нет
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      source TEXT DEFAULT 'danbooru',
      is_subscriber INTEGER DEFAULT 0,
      auto_send_time TEXT DEFAULT NULL,
      auto_send_tags TEXT DEFAULT NULL
    )
  `);
});

const bot = new Telegraf(process.env.BOT_TOKEN);
const ITEMS_PER_PAGE = 10;

// Конфигурация источников
const SOURCES = {
  danbooru: {
    name: 'Danbooru',
    url: 'https://danbooru.donmai.us/posts.json',
    params: (tags, page) => ({
      tags: `${tags} rating:g`,
      limit: ITEMS_PER_PAGE,
      page: page
    }),
    parser: (data) => data,
    caption: (post) => `Artist: ${post.tag_string_artist || 'Unknown'}`
  },
  e621: {
    name: 'e621',
    url: 'https://e621.net/posts.json',
    params: (tags, page) => ({
      tags: `${tags}`,
      limit: ITEMS_PER_PAGE,
      page: page
    }),
    parser: (data) => data.posts,
    caption: (post) => `Artist: ${post.tags.artist?.join(', ') || 'Unknown'}`,
    restricted: true, // for paid subscribers
    headers: {
      'User-Agent': 'YourBot/1.0 (by YourUsername)' // Укажите свои данные
    }
  },
  e926: {
    name: 'e926',
    url: 'https://e621.net/posts.json',
    params: (tags, page) => ({
      tags: `${tags} rating:safe`,
      limit: ITEMS_PER_PAGE,
      page: page
    }),
    parser: (data) => data.posts,
    caption: (post) => `Artist: ${post.tags.artist?.join(', ') || 'Unknown'}`,
    headers: {
      'User-Agent': 'YourBot/1.0 (by YourUsername)' // Укажите свои данные
    }
  },
  rule34: {
    name: 'Rule34',
    url: 'https://api.rule34.xxx/index.php',
    params: (tags, page) => ({
      page: 'dapi',
      s: 'post',
      q: 'index',
      json: 1,
      tags: tags,
      pid: page,
      limit: ITEMS_PER_PAGE
    }),
    parser: (data) => data,
    caption: (post) => `Artist: ${post.owner || 'Unknown'}\nTags: ${post.tags}`,
    restricted: true
  }
};

// Получение настроек пользователя
async function getUserSettings(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT source, is_subscriber, auto_send_time, auto_send_tags FROM users WHERE id = ?', [userId], (err, row) => {
      if (err) reject(err);
      resolve(row || { source: 'danbooru', is_subscriber: 0, auto_send_time: null, auto_send_tags: null });
    });
  });
}

// Обновление настроек пользователя
async function updateUserSettings(userId, settings) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR REPLACE INTO users (id, source, is_subscriber, auto_send_time, auto_send_tags) VALUES (?, ?, ?, ?, ?)',
      [userId, settings.source, settings.is_subscriber, settings.auto_send_time, settings.auto_send_tags],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

// Проверка доступа к источнику
async function checkAccess(userId, source) {
  const user = await getUserSettings(userId);
  if (SOURCES[source].restricted && !user.is_subscriber) {
    return false;
  }
  return true;
}

// Поиск постов
async function fetchPosts(source, tags, page = 1) {
  try {
    const { url, params, parser, headers } = SOURCES[source];
    const response = await axios.get(url, {
      params: params(tags, page),
      headers: headers || {}
    });
    return {
      results: parser(response.data) || [],
      nextPage: page + 1
    };
  } catch (error) {
    console.error(`[${source}] Error:`, error.message);
    return null;
  }
}

// Команда /start
bot.start(async (ctx) => {
  const userId = ctx.from.id;

  // Сохраняем пользователя в базу данных, если его нет
  db.run(
    `INSERT OR IGNORE INTO users (id, source, is_subscriber, auto_send_time, auto_send_tags) VALUES (?, 'danbooru', 0, NULL, NULL)`,
    [userId]
  );

  // Отправляем сообщение с кнопками
  await ctx.reply(
    `Привет, ${ctx.from.first_name || 'друг'}! 👋\n\n` +
      `Я бот для поиска и автоматической отправки артов.\n\n` +
      `📚 Возможности:\n` +
      `- Поиск по тегам\n` +
      `- Выбор источника\n` +
      `- Автоматическая отправка артов в ЛС или группу\n\n` +
      `Используй кнопки ниже, чтобы настроить бота:`,
    Markup.inlineKeyboard([
      [Markup.button.callback('⚙️ Настройки', 'open_settings')],
      [Markup.button.callback('✨ Подписка', 'subscribe')],
      [Markup.button.callback('⏰ Таймер', 'set_timer')]
    ])
  );
});

// Обработка нажатия кнопки "Настройки"
bot.action('open_settings', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUserSettings(userId);

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Danbooru', 'set_source_danbooru')],
    [Markup.button.callback('e926', 'set_source_e926')],
    [Markup.button.callback('e621 (только для подписчиков)', 'set_source_e621')],
    [Markup.button.callback('Rule34 (только для подписчиков)', 'set_source_rule34')]
  ]);

  ctx.reply(
    `⚙️ Текущий источник: ${SOURCES[user.source].name}\nВыберите новый источник:`,
    keyboard
  );
});

// Обработка нажатия кнопки "Подписка"
bot.action('subscribe', async (ctx) => {
  ctx.reply(
    '✨ Премиум подписка дает доступ к эксклюзивным источникам, например Rule34.\n\n' +
      `Чтобы оформить подписку, свяжитесь с администратором.`
  );
});

// Обработка нажатия кнопки "Таймер"
bot.action('set_timer', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUserSettings(userId);

  ctx.reply(
    `⏰ Введите время в формате ЧЧ:ММ (например, 21:00):`
  );

  // Ожидание ввода времени
  bot.on('text', async (ctx) => {
    const time = ctx.message.text.trim();
    const [hours, minutes] = time.split(':');

    // Проверка формата времени
    if (!/^\d{2}:\d{2}$/.test(time) || isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return ctx.reply('❌ Неверный формат времени. Введите время в формате ЧЧ:ММ (например, 21:00).');
    }

    // Преобразуем время в CRON-формат
    const cronTime = `${minutes} ${hours} * * *`;

    // Сохраняем время в настройках пользователя
    await updateUserSettings(userId, {
      ...user,
      auto_send_time: cronTime
    });

    // Запрашиваем источник
    ctx.reply(
      `✅ Время установлено: ${time}\n\n` +
      `Выберите источник для автоматической отправки:`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Danbooru', 'set_timer_source_danbooru')],
        [Markup.button.callback('e926', 'set_timer_source_e926')],
        [Markup.button.callback('e621 (только для подписчиков)', 'set_timer_source_e621')],
        [Markup.button.callback('Rule34 (только для подписчиков)', 'set_timer_source_rule34')]
      ])
    );
  });
});

// Обработка выбора источника для таймера
bot.action(/set_timer_source_(.+)/, async (ctx) => {
  const userId = ctx.from.id;
  const source = ctx.match[1];
  const user = await getUserSettings(userId);

  if (SOURCES[source].restricted && !user.is_subscriber) {
    return ctx.reply('❌ Доступ к этому источнику ограничен. Оформите подписку.');
  }

  // Сохраняем источник в настройках пользователя
  await updateUserSettings(userId, {
    ...user,
    source: source
  });

  // Запрашиваем теги
  ctx.reply(
    `✅ Источник установлен: ${SOURCES[source].name}\n\n` +
    `Введите теги для автоматической отправки (через пробел):`
  );

  // Ожидание ввода тегов
  bot.on('text', async (ctx) => {
    const tags = ctx.message.text.trim();

    // Сохраняем теги в настройках пользователя
    await updateUserSettings(userId, {
      ...user,
      auto_send_tags: tags
    });

    // Запуск таймера
    cron.schedule(user.auto_send_time, async () => {
      const data = await fetchPosts(source, tags);
      if (data && data.results.length) {
        const post = data.results[0];
        ctx.telegram.sendPhoto(userId, post.file_url || post.file.url, {
          caption: SOURCES[source].caption(post)
        });
      }
    });

    ctx.reply(
      `✅ Таймер настроен!\n` +
      `- Время: ${user.auto_send_time}\n` +
      `- Источник: ${SOURCES[source].name}\n` +
      `- Теги: ${tags}`
    );
  });
});

// Запуск бота
bot.launch();
console.log('Бот запущен!');