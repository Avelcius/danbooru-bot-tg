require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Обработка инлайн-запросов
bot.on('inline_query', async (ctx) => {
  const query = ctx.inlineQuery.query.trim(); // Получаем текст от пользователя

  console.log(`Получен запрос: ${query}`); // Логируем запрос пользователя

  if (!query) {
    console.log('Пустой запрос. Отправка пустого ответа.');
    return ctx.answerInlineQuery([]);
  }

  try {
    // Формируем строку тегов для поиска
    const tags = `rating:general+${query}`.split(' ').join('+'); // Заменяем пробелы на `+` для API Danbooru
    console.log(`Ищем с тегами: ${tags}`);

    // Количество постов, которые хотим получить
    const postsCount = 5;
    const results = [];

    for (let i = 0; i < postsCount; i++) {
      // Запрос к Danbooru API для случайного поста с тегами
      const response = await axios.get(`https://testbooru.donmai.us/posts/random.json?tags=${tags}`);

      console.log(`Запрос успешен.`);

      // Проверяем, есть ли файл в ответе
      if (!response.data || !response.data.file_url) {
        console.log('Не найдено постов или у поста нет файла.');
        continue; // Если нет файла, пропускаем этот запрос
      }

      // Логируем id поста
      const post = response.data;
      console.log(`Найден пост с id: ${post.id}`);

      // Формируем результат для отправки
      results.push({
        type: 'photo',
        id: String(post.id),
        photo_url: post.file_url,
        thumb_url: post.preview_file_url || post.file_url,
        caption: `Источник: ${post.tag_string_artist || 'Неизвестно'}`,
      });
    }

    // Отправка результатов с cache_time = 0 для отключения кеша
    await ctx.answerInlineQuery(results, { cache_time: 0 });
    console.log(`Отправлено ${results.length} результатов.`);
  } catch (error) {
    console.error('Ошибка при запросе к Danbooru API:', error.message);
    ctx.answerInlineQuery([], {
      cache_time: 0,
      switch_pm_text: 'Ошибка при поиске артов',
      switch_pm_parameter: 'error',
    });
  }
});

// Команда /start
bot.start((ctx) => {
  ctx.reply('Привет! Напиши что-нибудь в инлайн-режиме (например, @твой_бот <тег>)');
  console.log('Бот запущен и готов к работе.');
});

// Запуск бота
bot.launch();
console.log('Бот запущен!');
