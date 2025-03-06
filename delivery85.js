const { Telegraf, session } = require("telegraf");
const axios = require("axios");
require("dotenv").config();
const { MongoClient } = require('mongodb');

const mongoClient = new MongoClient(process.env.MONGODB_URI);

let db;
let usersCollection;

mongoClient.connect()
  .then(() => {
    console.log("Успешное подключение к MongoDB");
    db = mongoClient.db('delivery85');
    usersCollection = db.collection('users');
  })
  .catch(error => {
    console.error("Ошибка подключения к MongoDB:", error);
  });

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Middleware для сессий
bot.use(session());

// Middleware для работы с пользовательскими данными
bot.use(async (ctx, next) => {
  if (ctx && ctx.from) {
    if (!ctx.session) {
      ctx.session = {};
    }
    if (!ctx.session.userId) {
      const user = await usersCollection.findOne({ userId: ctx.from.id });
      if (user) {
        ctx.session.userId = user.userId;
        ctx.session.token = user.token;
      } else {
        ctx.session.userId = ctx.from.id;
      }
    }
  }
  await next();
});

const backendUrl = process.env.BACKEND_URL;
const backendUrlOrders = process.env.BACKEND_URL_ORDERS;
const chatUpdatesInterval = 120000;
const chatsData = {};

const currentTime = new Date();

bot.command("token", async (ctx) => {
  if (ctx && ctx.from) {
    const userId = ctx.from.id;
    const userMessage = ctx.message.text;
    const userToken = userMessage.split(" ")[1];
    
    if (userToken) {
      // Сохранение токена в MongoDB
      await usersCollection.updateOne(
        { userId: userId },
        { 
          $set: { 
            userId: userId, 
            token: userToken
          }
        },
        { upsert: true }
      );
      
      // Обновление токена в сессии
      ctx.session.token = userToken;
      
      ctx.reply("Токен успешно сохранен!");

      const chatId = ctx.message.chat.id;
      if (!chatsData[chatId]) {
        chatsData[chatId] = new Set();
        const intervalId = startCheckingForChanges(chatId, userId);
        chatsData[chatId].intervalId = intervalId;
        ctx.reply("Включены уведомления. Чтобы отключить уведомления, введите команду /off или выберите этот пункт в меню.");
      } 
    } else {
      ctx.reply("Используйте команду в формате: /token 'ваш_апи_ключ'");
    }
  } else {
    console.error("Ошибка: ctx или ctx.from не определены");
  }
});

bot.command("getApi", (ctx) => {
  const userId = ctx.from.id;
  const userToken = userTokens.get(userId);
  if (userToken) {
    ctx.reply(`Получаем данные с помощью API ключа: ${userToken}`);
  } else {
    ctx.reply("У вас не сохранен токен. Используйте /token 'ваш_апи_ключ', чтобы его сохранить.");
  }
});

async function stopBot(userId, message) {
  clearInterval(chatsData[userId].intervalId);
  delete chatsData[userId];
  await sendMessage(userId, message);
}

function addLeadingZero(num) {
  return num < 10 ? "0" + num : num;
}

function getUserTime(date) {
  let t = date.getTime() - 840 * 60 * 1000;
  let h = addLeadingZero(date.getHours());
  let m = addLeadingZero(date.getMinutes());
  let month = addLeadingZero(date.getMonth());
  return `${h}:${m}`;
}

async function sendMessage(chatId, message) {
  try {
    await bot.telegram.sendMessage(chatId, message, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (error) {
    console.log("Error sending message:", error);
  }
}

async function makeBackendRequest(userId) {
  const user = await usersCollection.findOne({ userId: userId });
  const userToken = user ? user.token : null;

  if (!userToken) {
    console.log("Отсутствует токен пользователя.");
    await stopBot(userId, "Ошибка: Ваш токен недействителен или отсутствует.")
    return null;
  }
  
  try {
    const config = {
      headers: {
        "Content-Type": "application/json",
        token: userToken,
      },
    };
    const response = await axios.get(backendUrl, config);
    console.log(user)
    return response.data;
  } catch (error) {
    console.log("Ошибка при выполнении запроса к бэкэнду:", error);
    return null;
  }
}

async function makeBackendRequestForOrder(id, userId) {
  const user = await usersCollection.findOne({ userId: userId });
  const userToken = user ? user.token : null;

  if (!userToken) {
    await stopBot(userId, "Ошибка: Ваш токен недействителен или отсутствует. Запросы к бэкэнду приостановлены.")
    return null;
  }

  try {
    const config = {
      headers: {
        "Content-Type": "application/json",
        token: userToken,
      },
    };
    let fullbackendUrlOrder = `${backendUrlOrders}${id}`;
    const response = await axios.get(fullbackendUrlOrder, config);
    return response.data;
  } catch (error) {
    console.log("Ошибка при выполнении запроса к бэкэнду:", error);
    return null;
  }
}

function wishesData(data) {
  let wishes = data.Wishes;
  let wishesText = `▼ Пожелания к заказу:\n\n`
  if(wishes.length > 0) {
    wishes.forEach((item, index) => {
      wishesText += `${index + 1})${item.Name}\n`
    })
  }
  else {
  wishesText += `ツ Нету\n`;
  }
  return wishesText;
}

function parseData(data) {
  let parsedText = `<b>▼ Состав заказа:</b>\n\n`;

  data.forEach((item, index) => {
    parsedText += `<b>${index + 1})${item.ProductName}</b>\n`;
    if(item.Products) {
      item.Products.forEach((item)=>{
        parsedText += `   ○ ${item.ProductName} ${item.Quantity}\n`
      })
    }

    if (item.Quantity > 1) {
      parsedText += `   ○ <b>Количество: </b>‼️${item.Quantity}\n`;
    }
  });

  return parsedText;
}

function isTimeToTurnOffNotifications() {
  const currentTime = new Date();
  const currentHour = currentTime.getHours();
  return currentHour >= 22;
}

function startCheckingForChanges(chatId, userId) {
  return setInterval(async () => {
    if (isTimeToTurnOffNotifications()) {
      console.log(`22:00, уведомеление выключены.`);
      clearInterval(chatsData[chatId].intervalId);
      delete chatsData[chatId];
      await sendMessage(chatId, "Уведомления в чате деактивированы.");
      return;
    }
    try {
      const newResponse = await makeBackendRequest(userId);

      if (!newResponse || newResponse.length === 0) {
        return;
      }
      const processedOrderIds = chatsData[chatId] || new Set();
      const newOrders = newResponse.filter(
        (order) =>
          order.Status === 12 && !processedOrderIds.has(order.DeliveryNumber)
      );

      if (newOrders.length > 0) {
        for (const newOrder of newOrders) {
          const newResponseOrder = await makeBackendRequestForOrder(
            newOrder.OrderId, userId
          );

          const markerColor = "org"; // Цвет маркер (org - оранжевый)
          const markerSize = "pm2"; // Размер маркера (pm2 - маленький)
          const mapLink = `https://yandex.com/maps/?ll=${newOrder.Longitude},${newOrder.Latitude}&z=12&pt=${newOrder.Longitude},${newOrder.Latitude},${markerColor}${markerSize}`;
          let parsedData = parseData(newResponseOrder);
          let wishedData = wishesData(newOrder);
          const message = `
            <b>Заказ #${newOrder.DeliveryNumber}</b>\n
            <b>▶ Адрес: </b> <a href="${mapLink}">${newOrder.Address}</a>\n
            <b>▶ Желаемое время: </b> ${getUserTime(
              new Date(newOrder.WishingDate)
            )}\n
            <b>▶ Ближайшее: </b> ${newOrder.Nearest ? "Да" : "Нет"}\n
            <b>▶ Телефон: </b> <a href="tel:+${newOrder.ClientPhone}">+${
            newOrder.ClientPhone
          }</a>\n
            <pre>${wishedData}</pre>\n
            <pre>${parsedData}</pre>
          `;
          await sendMessage(chatId, message);
          processedOrderIds.add(newOrder.DeliveryNumber);
        }
      }

      chatsData[chatId] = processedOrderIds;
    } catch (error) {
      console.log("Error checking for changes:", error);
    }
  }, chatUpdatesInterval);
}

bot.command("start", async (ctx) => {
  const chatId = ctx.message.chat.id;
  const userId = ctx.from.id;

  // Проверяем, есть ли у пользователя сохраненный токен
  const user = await usersCollection.findOne({ userId: userId });
  const userToken = user ? user.token : null;

  if (!chatsData[chatId]) {
    chatsData[chatId] = new Set();
    const intervalId = startCheckingForChanges(chatId, userId);
    chatsData[chatId].intervalId = intervalId;
    ctx.reply("Уведомления включены. Чтобы их отключить, введите команду /off или выберите пункт в меню. Если вы перешли из приложения и вам нужно ввести токен доступа, он находится в буфере обмена. Просто вставьте его в чат с ботом." );
    console.log(`Уведомления включены. ${getUserTime(currentTime)}`);
  } else {
    ctx.reply("Уведомления уже активны.");
  }
  
  if(!userToken) {
    ctx.reply("У вас нет сохраненного токена. Пожалуйста, используйте команду /token для установки вашего токена.");
  }
});


bot.command("off", async (ctx) => {
  const chatId = ctx.message.chat.id;
  if (chatsData[chatId]) {
    console.log("Bot is stopping...");
    const intervalId = chatsData[chatId].intervalId;
    if (intervalId) {
      clearInterval(intervalId);
      delete chatsData[chatId].intervalId;
    }
    delete chatsData[chatId];

    ctx.reply("Уведомления деактивированы.Для включения уведомлений наберите команду /start или выберите этот пункт в меню.");
    console.log(`Уведомления деактивированы. ${getUserTime(currentTime)}`);
  } else {
    ctx.reply(`Уведомления уже отлючены.`);
  }
});

bot.command("help", (ctx) => {
  const helpMessage = `
Список доступных команд:

/token [ваш_апи_ключ] - Эта команда позволяет пользователю сохранить свой API-ключ. После сохранения токена, бот автоматически включает уведомления.
/start - Включает уведомления и проверяет наличие сохраненного токена.
/off - Отключает уведомления.
  `;
  
  ctx.reply(helpMessage);
});

bot
  .launch()
  .then(() => {
    console.log("Telegram bot is running.");
  })
  .catch((error) => {
    console.log("Error launching the Telegram bot:", error);
  });

// Enable graceful stop!
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Обработка закрытия соединения с MongoDB при завершении работы бота
process.on('SIGINT', async () => {
  await mongoClient.close();
  process.exit();
});