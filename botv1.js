require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Обработка инлайн-запросов
bot.on('inline_query', async (ctx) => {
  const query = ctx.inlineQuery.query.trim(); // Получаем текст от пользователя

  if (!query) {
    return ctx.answerInlineQuery([]);
  }

  try {
    const random = 'Math.random'
    // Добавляем тег `rating:sensitive` по умолчанию
    const tags = `rating:general ${query}`.split(' ').join('+'); // Заменяем пробелы на `+` для API Danbooru

    // Запрос к Danbooru API
    const response = await axios.get('https://danbooru.donmai.us/posts.json', {
      params: {
        tags: tags,
        limit: 50, // Количество артов в результате
        page: random,
      },
    });

    const results = response.data
      .filter((post) => post.file_url) // Убедимся, что есть файл
      .map((post, index) => ({
        type: 'photo',
        id: String(index),
        photo_url: post.file_url,
        thumb_url: post.preview_file_url || post.file_url,
        caption: `Источник: ${post.tag_string_artist || 'Неизвестно'}`,
      }));

    // Отправка результатов
    await ctx.answerInlineQuery(results, { cache_time: 0 });
  } catch (error) {
    console.error('Ошибка при запросе к Danbooru API:', error.message);
    ctx.answerInlineQuery([], { cache_time: 0, switch_pm_text: 'Ошибка при поиске артов', switch_pm_parameter: 'error' });
  }
});

// Команда /start
bot.start((ctx) => {
  ctx.reply('Привет! Напиши что-нибудь в инлайн-режиме (например, @твой_бот <тег>)');
});

// Запуск бота
bot.launch();
console.log('Бот запущен!');

