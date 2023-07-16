const { Telegraf } = require('telegraf');
const axios = require('axios');
require('dotenv').config()

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const chatId = '-1001896856591';
const config = {
    method: "GET",
    headers: {
    "content-type": "application/json",
    token: process.env.BACKEND_TOKEN
    }
  };

let lastResponse = [];

// Функция для отправки сообщения в Telegram
function sendMessage(chatId, message) {
  bot.telegram.sendMessage(chatId, message, {parse_mode: 'Markdown'})
    .catch((error) => console.log('Ошибка при отправке сообщения:', error));
}

// Функция для выполнения запроса к бэкенду
async function makeBackendRequest() {
  try {
    const response = await axios.get(process.env.BACKEND_URL_ORDERS, config);
    return response.data;
  } catch (error) {
    console.log('Ошибка при выполнении запроса к бэкенду:', error);
    return null;
  }
}
 const days = [
  "Воскресенья",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
];

function addLeadingZero(d) {
  return d < 10 ? "0" + d : d;
}

function GetUserTime(t) {
  let tr = t - 840 * 60;
  let Y = t.getFullYear();
  let M = addLeadingZero(t.getMonth() + 1);
  let D = addLeadingZero(t.getDate());
  let d = days[t.getDay()];
  let h = addLeadingZero(t.getHours());
  let m = addLeadingZero(t.getMinutes());
  return `${h}:${m}`;
}

// Функция для сравнения ответа от бэкенда и отправки изменений в Telegram
async function checkForChanges() {
  makeBackendRequest().then((newResponse) => {

    //const markerColor = 'org'; // Цвет маркера (org - оранжевый)
    //const markerSize = 'pm2'; // Размер маркера (pm2 - маленький) 
    //const mapLink = `https://yandex.com/maps/?ll=${newResponse[0].Longitude},${newResponse[0].Latitude}&z=12&pt=${newResponse[0].Longitude},${newResponse[0].Latitude},${markerColor}${markerSize}`;

    const newOrder = `
    Заказ #${newResponse[0].DeliveryNumber}
    + Адрес: ${newResponse[0].Address}
    + Желаемое время: ${GetUserTime(new Date(newResponse[0].WishingDate))} 
    + Ближайшее: ${newResponse[0].Nearest? 'Да' : 'Нет' }
    + Тел: [+${newResponse[0].ClientPhone}](tel:+${newResponse[0].ClientPhone})
    `;

  if(lastResponse.length === 0) {
    if([...newResponse.filter((e)=> e.Status === 12)].length !== 0) {
        sendMessage(chatId, newOrder);
        lastResponse = newResponse;
        console.log("Обновляем счетчик в ифе");
    }
    lastResponse = newResponse;
    console.log(`Обновляем счетчик ${lastResponse.length}`);
  } else if (newResponse.length > lastResponse.length) {
    console.log(`${newResponse.length} ${lastResponse.length} true`);
    sendMessage(chatId, newOrder);
    lastResponse = newResponse;
  } else {
    console.log(`${newResponse.length} ${lastResponse.length} false`);
  }
  })}
  
// Запуск проверки изменений каждую минуту
setInterval(checkForChanges, 30000);

// Запуск телеграм-бота
bot.launch()
  .then(() => console.log('Телеграм-бот запущен.'))
  .catch((error) => console.log('Ошибка при запуске телеграм-бота:', error));