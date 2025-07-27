import { randomUUID } from "node:crypto";
import http from "node:http";
import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import pino from "pino";
import pinoPretty from "pino-pretty";
import WebSocket, { WebSocketServer } from "ws";

const app = express();
const logger = pino(pinoPretty());

app.use(cors());
app.use(bodyParser.json());
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json");
  next();
});

const userState = [];
const wsUserMap = new Map(); // ws -> user

app.post("/new-user", async (request, response) => {
  const { name } = request.body;
  if (!name) {
    return response.status(400).send(JSON.stringify({
      status: "error",
      message: "Name is required!"
    })).end();
  }
  const isExist = userState.find((user) => user.name === name);
  if (!isExist) {
    const newUser = {
      id: randomUUID(),
      name: name,
    };
    userState.push(newUser);
    logger.info(`New user created: ${JSON.stringify(newUser)}`);
    return response.send(JSON.stringify({
      status: "ok",
      user: newUser,
    })).end();
  } else {
    logger.error(`User with name "${name}" already exist`);
    return response.status(409).send(JSON.stringify({
      status: "error",
      message: "This name is already taken!",
    })).end();
  }
});

const server = http.createServer(app);
const wsServer = new WebSocketServer({ server });

wsServer.on("connection", (ws) => {
  ws.on("message", (msg, isBinary) => {
    const receivedMSG = JSON.parse(msg);
    logger.info(`Message received: ${JSON.stringify(receivedMSG)}`);

    // Логин пользователя
    if (receivedMSG.type === "login") {
      // Проверка уникальности имени
      let user = userState.find(u => u.name === receivedMSG.name);
      if (!user) {
        user = { id: randomUUID(), name: receivedMSG.name };
        userState.push(user);
      }
      wsUserMap.set(ws, user);

      // Отправляем подтверждение логина и список пользователей
      ws.send(JSON.stringify({ type: "login", success: true, users: userState }));
      broadcastUsers();
      return;
    }

    // Обработка выхода пользователя
    if (receivedMSG.type === "exit") {
      const user = wsUserMap.get(ws);
      if (user) {
        const idx = userState.findIndex((u) => u.id === user.id);
        if (idx !== -1) userState.splice(idx, 1);
        wsUserMap.delete(ws);
        broadcastUsers();
        logger.info(`User with name "${user.name}" has been deleted`);
      }
      return;
    }

    // Обработка отправки сообщения
    if (receivedMSG.type === "send") {
      const user = wsUserMap.get(ws);
      const messageToSend = {
        type: "send",
        message: receivedMSG.message,
        user: user ? { id: user.id, name: user.name } : null,
        time: new Date().toLocaleTimeString()
      };
      broadcastAll(JSON.stringify(messageToSend));
      logger.info("Message sent to all users");
      return;
    }
  });

  ws.on("close", () => {
    const user = wsUserMap.get(ws);
    if (user) {
      const idx = userState.findIndex((u) => u.id === user.id);
      if (idx !== -1) userState.splice(idx, 1);
      wsUserMap.delete(ws);
      broadcastUsers();
      logger.info(`User with name "${user.name}" disconnected`);
    }
  });

  // При подключении отправляем список пользователей
  ws.send(JSON.stringify({ type: "users", users: userState }));
});

function broadcastAll(data) {
  [...wsServer.clients]
    .filter((o) => o.readyState === WebSocket.OPEN)
    .forEach((o) => o.send(data));
}

function broadcastUsers() {
  const data = JSON.stringify({ type: "users", users: userState });
  broadcastAll(data);
}

const port = process.env.PORT || 7070;

const bootstrap = async () => {
  try {
    server.listen(port, () =>
      logger.info(`Server has been started on http://localhost:${port}`)
    );
  } catch (error) {
    logger.error(`Error: ${error.message}`);
  }
};

bootstrap();