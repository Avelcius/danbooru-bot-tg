require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

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
      is_subscriber INTEGER DEFAULT 0
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
    restricted: true, // for paid subsriber//you can turn false
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
    db.get('SELECT source, is_subscriber FROM users WHERE id = ?', [userId], (err, row) => {
      if (err) reject(err);
      resolve(row || { source: 'danbooru', is_subscriber: 0 });
    });
  });
}

// Обновление настроек пользователя
async function updateUserSettings(userId, source) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR REPLACE INTO users (id, source) VALUES (?, ?)',
      [userId, source],
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

// Команда /settings
bot.command('settings', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUserSettings(userId);

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Danbooru', 'set_source_danbooru')],
    [Markup.button.callback('e926', 'set_source_e926')],
    [Markup.button.callback('e621 (только для подписчиков)', 'set_source_e621')],
    [Markup.button.callback('Rule34 (только для подписчиков)', 'set_source_rule34')]
  ]);

  ctx.reply(`Текущий источник: ${SOURCES[user.source].name}\nВыберите новый источник:`, keyboard);
});

// Обработка выбора источника
bot.action(/set_source_(.+)/, async (ctx) => {
  const userId = ctx.from.id;
  const source = ctx.match[1];

  if (SOURCES[source].restricted && !(await checkAccess(userId, source))) {
    return ctx.reply('❌ Доступ к этому источнику ограничен. Оформите подписку.');
  }

  await updateUserSettings(userId, source);
  ctx.reply(`✅ Источник изменен на: ${SOURCES[source].name}`);
});

// Инлайн-режим
bot.on('inline_query', async (ctx) => {
  const userId = ctx.from.id;
  const query = ctx.inlineQuery.query.trim();
  const offset = parseInt(ctx.inlineQuery.offset) || 1;
  const currentPage = offset === 0 ? 1 : offset;

  if (!query) return;

  const user = await getUserSettings(userId);
  const source = user.source;

  if (!(await checkAccess(userId, source))) {
    return ctx.answerInlineQuery([{
      type: 'article',
      id: 'no_access',
      title: '❌ Доступ ограничен',
      input_message_content: {
        message_text: 'У вас нет доступа к этому источнику. Оформите подписку.'
      }
    }]);
  }

  const data = await fetchPosts(source, query, currentPage);
  if (!data || !data.results.length) {
    return ctx.answerInlineQuery([{
      type: 'article',
      id: 'no_results',
      title: 'Ничего не найдено',
      input_message_content: {
        message_text: 'По вашему запросу ничего не найдено 😢\nПопробуйте другие теги'
      }
    }]);
  }

  const inlineResults = data.results.map((post, index) => ({
    type: 'photo',
    id: `${source}_${post.id}_${Date.now()}_${index}`,
    photo_url: post.file_url || post.file.url,
    thumb_url: post.preview_url || post.preview?.url || post.file_url,
    caption: SOURCES[source].caption(post)
  }));

  ctx.answerInlineQuery(inlineResults, {
    next_offset: data.nextPage,
    cache_time: 30
  });
});

// Запуск бота
bot.launch();
console.log('Бот запущен!');