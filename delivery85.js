const { Telegraf } = require("telegraf");
const axios = require("axios");
require("dotenv").config();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const userTokens = new Map();
const backendUrl = process.env.BACKEND_URL;
const backendUrlOrders = process.env.BACKEND_URL_ORDERS;
const chatUpdatesInterval = 25000;
const chatsData = {};

bot.command("token", (ctx) => {
  const userId = ctx.from.id;
  const userMessage = ctx.message.text;
  const userToken = userMessage.split(" ")[1];
  
  if (userToken) {
    userTokens.set(userId, userToken);
    ctx.reply("Токен успешно сохранен!");
  } else {
    ctx.reply("Используйте команду в формате: /token 'ваш_апи_ключ'");
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
  const userToken = userTokens.get(userId);
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
    return response.data;
  } catch (error) {
    console.log("Ошибка при выполнении запроса к бэкэнду:", error);
    await stopBot(userId, "Ошибка: Не верный токен. Запросы к бэкэнду приостановлены.")
    return null;
  }
}

async function makeBackendRequestForOrder(id, userId) {
  const userToken = userTokens.get(userId);

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
    await stopBot(userId, "Ошибка: Ваш токен недействителен или отсутствует. Запросы к бэкэнду приостановлены.")
    console.log("Ошибка при выполнении запроса к бэкэнду:", error);
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
  return currentHour >= 23;
}

function startCheckingForChanges(chatId, userId) {
  return setInterval(async () => {
    if (isTimeToTurnOffNotifications()) {
      console.log(`22:00, уведомеление выключены.`);
      clearInterval(chatsData[chatId].intervalId);
      delete chatsData[chatId];
      await sendMessage(chatId, "Уведомления в чате деактивированы.");
      return; // Stop further execution of the interval
    }
  
    const currentTime = new Date();

    try {
      const newResponse = await makeBackendRequest(userId);

      if (!newResponse || newResponse.length === 0) {
        console.log(`Equal to 0 ${getUserTime(currentTime)}`);
        return;
      }

      console.log(`Not equal to 0 || ${getUserTime(currentTime)}`);

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

          const markerColor = "org"; // Цвет маркера (org - оранжевый)
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
  const userToken = userTokens.get(userId);

  if (!chatsData[chatId]) {
    chatsData[chatId] = new Set();
    const intervalId = startCheckingForChanges(chatId, userId);
    chatsData[chatId].intervalId = intervalId;
    ctx.reply("Уведомления активированы. Для отключения уведомлений наберите команду /off или выберите этот пункт в меню. Если вы перешли с приложения и требует токен, то тогда токен находится у вас в буфере обмена, просто вставьте его в чат с ботом.");
  } else {
    ctx.reply("Уведомления уже активны.");
  }
  if(!userToken) {
  //await stopBot(userId, "Ошибка: Ваш токен недействителен или отсутствует. Запросы к бэкэнду приостановлены.")
  return null;
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
  } else {
    ctx.reply("Уведомления уже отлючены.");
  }
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
