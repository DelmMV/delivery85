const { Telegraf } = require("telegraf");
const axios = require("axios");
require("dotenv").config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const chatId = "-1001896856591";
const config = {
  headers: {
    "Content-Type": "application/json",
    "token": process.env.BACKEND_TOKEN,
  },
};
const days = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
];

let lastResponse = [];

function addLeadingZero(d) {
  return d < 10 ? "0" + d : d;
}

function getUserTime(t) {
  let tr = t - 840 * 60;
  let Y = t.getFullYear();
  let M = addLeadingZero(t.getMonth() + 1);
  let D = addLeadingZero(t.getDate());
  let d = days[t.getDay()];
  let h = addLeadingZero(t.getHours());
  let m = addLeadingZero(t.getMinutes());
  return `${h}:${m}`;
}

async function sendMessage(chatId, message) {
  try {
    await bot.telegram.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    console.log("Ошибка при отправке сообщения:", error);
  }
}

async function makeBackendRequest() {
  try {
    const response = await axios.get(process.env.BACKEND_URL_ORDERS, config);
    return response.data;
  } catch (error) {
    console.log("Ошибка при выполнении запроса к бэкенду:", error);
    return null;
  }
}

// Функция для сравнения ответа от бэкенда и отправки изменений в Telegram
async function checkForChanges() {
  const currentTime = getUserTime(new Date());

  if (currentTime > "08:00" && currentTime < "22:00") {
    try {
      const newResponse = await makeBackendRequest();

      if (!newResponse || newResponse.length === 0) {
        console.log(`Equal to 0 ${currentTime}`);
        return;
      }

      console.log(`Not equal to 0 || ${currentTime}`);

      const newOrder = `
        Заказ #${newResponse[0].DeliveryNumber}
        + Адрес: ${newResponse[0].Address}
        + Желаемое время: ${getUserTime(new Date(newResponse[0].WishingDate))} 
        + Ближайшее: ${newResponse[0].Nearest ? "Да" : "Нет"}
        + Тел: [+${newResponse[0].ClientPhone}](tel:+${newResponse[0].ClientPhone})
      `;

      if (lastResponse.length === 0) {
        if (newResponse.some((e) => e.Status === 12)) {
          await sendMessage(chatId, newOrder);
          lastResponse = newResponse;
          console.log("Обновляем счетчик в if");
        }
        lastResponse = newResponse;
        console.log(`Обновляем счетчик ${lastResponse.length}`);
      } else if (newResponse.length > lastResponse.length) {
        console.log(`${newResponse.length} ${lastResponse.length} true`);
        await sendMessage(chatId, newOrder);
        lastResponse = newResponse;
      } else {
        console.log(`${newResponse.length} ${lastResponse.length} false`);
      }
    } catch (error) {
      console.log("Ошибка при проверке изменений:", error);
    }
  } else {
    lastResponse = [];
    console.log("Еще не время");
  }
}

setInterval(checkForChanges, 30000);

bot
  .launch()
  .then(() => console.log("Телеграм-бот запущен."))
  .catch((error) => console.log("Ошибка при запуске телеграм-бота:", error));