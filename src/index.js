const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
require("dotenv").config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const backendUrl = process.env.BACKEND_URL;
const backendUrlOrders = process.env.BACKEND_URL_ORDERS;
const backendToken = process.env.BACKEND_TOKEN;
const chatUpdatesInterval = 25000; // 25 seconds

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

async function makeBackendRequest() {
  try {
    const config = {
      headers: {
        "Content-Type": "application/json",
        token: backendToken,
      },
    };
    const response = await axios.get(backendUrl, config);
    return response.data;
  } catch (error) {
    console.log("Error making backend request:", error);
    return null;
  }
}

async function makeBackendRequestForOrder(id) {
  try {
    const config = {
      headers: {
        "Content-Type": "application/json",
        token: backendToken,
      },
    };
    let fullbackendUrlOrder = `${backendUrlOrders}${id}`;
    const response = await axios.get(fullbackendUrlOrder, config);
    return response.data;
  } catch (error) {
    console.log("Error making backend request:", error);
    return null;
  }
}

function parseData(data) {
  let parsedText = "<b>Состав заказа:</b>\n\n";

  data.forEach((item, index) => {
    parsedText += `<b>+ ${item.ProductName}</b>\n`;

    if (item.Quantity > 1) {
      parsedText += `<b>Количество:</b> ${item.Quantity}\n`;
    }
  });

  return parsedText;
}

const chatsData = {};

function startCheckingForChanges(chatId) {
  return setInterval(async () => {
    const currentTime = new Date();
    const currentHour = currentTime.getUTCHours();

    //     if (currentHour < 22) {
    // return
    //     }

    try {
      const newResponse = await makeBackendRequest();

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
            newOrder.OrderId
          );
          const markerColor = "org"; // Цвет маркера (org - оранжевый)
          const markerSize = "pm2"; // Размер маркера (pm2 - маленький)
          const mapLink = `https://yandex.com/maps/?ll=${newOrder.Longitude},${newOrder.Latitude}&z=12&pt=${newOrder.Longitude},${newOrder.Latitude},${markerColor}${markerSize}`;
          let parsedData = parseData(newResponseOrder);
          const message = `
            <b>Заказ #${newOrder.DeliveryNumber}</b>\n
            <b>+ Адрес: </b> <a href="${mapLink}">${newOrder.Address}</a>\n
            <b>+ Желаемое время: </b> ${getUserTime(
              new Date(newOrder.WishingDate)
            )}\n
            <b>+ Ближайшее: </b> ${newOrder.Nearest ? "Да" : "Нет"}\n
            <b>+ Тел: </b> <a href="tel:+${newOrder.ClientPhone}">+${
            newOrder.ClientPhone
          }</a>\n
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

bot.command("start", (ctx) => {
  const chatId = ctx.message.chat.id;
  if (!chatsData[chatId]) {
    chatsData[chatId] = new Set();
    const intervalId = startCheckingForChanges(chatId);
    chatsData[chatId].intervalId = intervalId;

    // Create a custom keyboard with the "Turn Off Bot" button
    const replyMarkup = Markup.keyboard([
      Markup.button.text("Выключить уведомления"),
    ]).resize();

    ctx.reply("Уведомления в чате активированы.", replyMarkup);
  } else {
    ctx.reply("Уведомления уже активны в этом чате.");
  }
});

bot.hears("Выключить уведомления", async (ctx) => {
  const chatId = ctx.message.chat.id;
  if (chatsData[chatId]) {
    console.log("Bot is stopping...");
    const intervalId = chatsData[chatId].intervalId;
    if (intervalId) {
      clearInterval(intervalId);
      delete chatsData[chatId].intervalId;
    }
    delete chatsData[chatId];

    // Create a custom keyboard with the "Turn On Bot" button
    const replyMarkup = Markup.keyboard([
      Markup.button.text("Включить уведомления"),
    ]).resize();

    ctx.reply("Уведомления в чате деактивированы.", replyMarkup);
  } else {
    ctx.reply("Уведомления уже отлючены в этом чате.");
  }
});

bot.hears("Включить уведомления", (ctx) => {
  const chatId = ctx.message.chat.id;
  if (!chatsData[chatId]) {
    chatsData[chatId] = new Set();
    const intervalId = startCheckingForChanges(chatId);
    chatsData[chatId].intervalId = intervalId;

    // Create a custom keyboard with the "Turn Off Bot" button
    const replyMarkup = Markup.keyboard([
      Markup.button.text("Выключить уведомления"),
    ]).resize();

    ctx.reply("Уведомления в чате активированы.", replyMarkup);
  } else {
    ctx.reply("Уведомления уже активны в этом чате.");
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
