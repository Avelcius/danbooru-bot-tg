require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ITEMS_PER_PAGE = 10;

// Конфигурация Danbooru
const DANBOORU_API = {
  url: 'https://danbooru.donmai.us/posts.json',
  params: (tags, page) => ({
    tags: `${tags} rating:g`,
    limit: ITEMS_PER_PAGE,
    page: page
  }),
  parser: (data) => data,
  caption: (post) => `Artist: ${post.tag_string_artist || 'Unknown'}\nSource: Danbooru`
};

async function fetchDanbooruPosts(tags, page = 1) {
  try {
    const response = await axios.get(DANBOORU_API.url, {
      params: DANBOORU_API.params(tags, page)
    });
    return {
      results: DANBOORU_API.parser(response.data) || [],
      nextPage: page + 1
    };
  } catch (error) {
    console.error('Danbooru API Error:', error.message);
    return null;
  }
}

bot.on('inline_query', async (ctx) => {
  const query = ctx.inlineQuery.query.trim();
  const offset = parseInt(ctx.inlineQuery.offset) || 1;
  const currentPage = offset === 0 ? 1 : offset;

  if (!query) {
    return ctx.answerInlineQuery([], {
      switch_pm_text: 'Введите теги для поиска',
      switch_pm_parameter: 'help'
    });
  }

  const data = await fetchDanbooruPosts(query, currentPage);
  
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
    id: `danbooru_${post.id}_${Date.now()}_${index}`,
    photo_url: post.file_url,
    thumb_url: post.preview_url || post.file_url,
    caption: DANBOORU_API.caption(post)
  }));


  ctx.answerInlineQuery(inlineResults, {
    next_offset: data.nextPage,
    cache_time: 30
  });
});

bot.catch((err) => {
  console.error('Bot Error:', err);
});

bot.launch();
console.log('Бот для Danbooru запущен!');