const { Telegraf } = require("telegraf");
const axios = require("axios");
const fs = require('fs');
const express = require('express');
require("dotenv").config();

const savedToken = readTokenFromFile();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const backendUrl = process.env.BACKEND_URL;
const backendUrlOrders = process.env.BACKEND_URL_ORDERS;
const backendToken = '44EaA35uimY9p6p/hPLQC8XAoANzTRFY683c6vV/CjFoKOPDUFTO7HmBNCCYKvRY'
const chatUpdatesInterval = 25000; // 25 seconds

console.log(backendToken)



// const app = express();
// const PORT = 3001;
//
// app.get('/auth', (req, res) => {
//   res.json(backendToken);
// });
//
// app.get('/', (req, res) => {
//   res.json(backendUrlOrders)
// })
//
// // Слушаем выбранный порт
// app.listen(PORT, () => {
//   console.log(`Сервер запущен на порту ${PORT}`);
// });

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
        token: savedToken,
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
        token: savedToken,
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

const chatsData = {};

function startCheckingForChanges(chatId) {
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

function readTokenFromFile() {
  try {
    const token = fs.readFileSync('token.txt', 'utf8');
    return token.trim(); // Убираем лишние пробелы, символы перевода строки и т.д.
  } catch (err) {
    console.error('Ошибка при чтении токена из файла:', err);
    return null;
  }
}
bot.command('token', (ctx) => {
  const input = ctx.message.text.split(' ');
  if (input.length === 2) {
    const token = input[1];
    
    // Сохраняем токен в файл (можно выбрать другой способ хранения)
    fs.writeFile('token.txt', token, (err) => {
      if (err) {
        console.error('Ошибка при сохранении токена:', err);
        ctx.reply('Произошла ошибка при сохранении токена');
      } else {
        console.log('Токен успешно сохранен');
        ctx.reply('Токен успешно сохранен');
      }
    });
  } else {
    ctx.reply('Пожалуйста, введите команду в формате: /token "ваш_токен"');
  }
});

bot.command("start", async (ctx) => {
  const chatId = ctx.message.chat.id;
  if (!chatsData[chatId]) {
    chatsData[chatId] = new Set();
    const intervalId = startCheckingForChanges(chatId);
    chatsData[chatId].intervalId = intervalId;
    ctx.reply("Уведомления активированы. Для отключения уведомлений наберите команду /off или выберите этот пункт в меню.");
  } else {
    ctx.reply("Уведомления уже активны.");
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

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
