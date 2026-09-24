import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  }),
);
app.use(express.json());

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

// Conexión e Inicialización de la Base de Datos con Historial Completo
let db;
(async () => {
  try {
    db = await open({
      filename: "./seguridad.db",
      driver: sqlite3.Database,
    });

    // Tabla de usuarios
    await db.exec(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        pin TEXT,
        verification_code TEXT,
        is_verified INTEGER DEFAULT 0
      )
    `);

    // NUEVA TABLA: Historial Forense de Sitios Maliciosos
    await db.exec(`
      CREATE TABLE IF NOT EXISTS historial (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT,
        threat_type TEXT,
        reason TEXT,
        fecha TEXT,
        action TEXT DEFAULT 'Bloqueado'
      )
    `);

    console.log(
      "🗄️ Base de datos SQLite conectada. Tablas de Usuarios e Historial listas.",
    );
  } catch (err) {
    console.error("Error inicializando SQLite:", err);
  }
})();

// ✉️ ENDPOINT: REGISTRO
app.post("/api/auth/register", async (req, res) => {
  const { email, pin } = req.body;
  if (!email || !email.includes("@") || !pin || pin.length !== 4) {
    return res
      .status(400)
      .json({ error: "Datos inválidos. El PIN debe ser de 4 dígitos." });
  }
  const verificationCode = Math.floor(
    100000 + Math.random() * 900000,
  ).toString();
  try {
    await db.run(
      `INSERT INTO usuarios (email, pin, verification_code, is_verified) VALUES (?, ?, ?, 0)
       ON CONFLICT(email) DO UPDATE SET pin=?, verification_code=?, is_verified=0`,
      [email, pin, verificationCode, pin, verificationCode],
    );
    console.log(`\n======================================================`);
    console.log(
      `✉️ [SIMULADOR] Código de Activación para ${email}: ${verificationCode}`,
    );
    console.log(`======================================================\n`);
    res.json({ success: true, message: "Código generado." });
  } catch (error) {
    res.status(500).json({ error: "Error en el registro." });
  }
});

// 🔑 ENDPOINT: VERIFICACIÓN OTP
app.post("/api/auth/verify", async (req, res) => {
  const { email, code } = req.body;
  try {
    const usuario = await db.get("SELECT * FROM usuarios WHERE email = ?", [
      email,
    ]);
    if (!usuario || usuario.verification_code !== code) {
      return res
        .status(400)
        .json({ success: false, error: "Código incorrecto." });
    }
    await db.run(
      "UPDATE usuarios SET is_verified = 1, verification_code = NULL WHERE email = ?",
      [email],
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error de validación." });
  }
});

// 🕵️‍♂️ ENDPOINT: ANALIZADOR (Guarda automáticamente las amenazas encontradas)
app.post("/api/analyze", async (req, res) => {
  const { textContent, currentUrl } = req.body;
  if (!textContent || !currentUrl)
    return res.status(400).json({ error: "Faltan parámetros." });

  const fechaActual = new Date().toLocaleString();

  // 1. FILTRO DE CONTINGENCIA LOCAL EN BACKEND
  const textoMin = textContent.toLowerCase();
  if (
    textoMin.includes("litecoin gratis") &&
    (textoMin.includes("deposito minimo") || textoMin.includes("urgente"))
  ) {
    const backupReport = {
      isThreat: true,
      score: 95,
      threatType: "Estafa Financiera / Esquema Ponzi",
      reason:
        "El sistema detectó una solicitud de depósito de capital urgente condicionada a la liberación de un falso saldo de criptomonedas.",
    };

    // Guardamos la estafa en la tabla de historial de la Base de Datos
    await db.run(
      `INSERT INTO historial (url, threat_type, reason, fecha, action) VALUES (?, ?, ?, ?, 'Bloqueado')`,
      [currentUrl, backupReport.threatType, backupReport.reason, fechaActual],
    );

    return res.json(backupReport);
  }

  // 2. ESCANEO INTELIGENTE CON GEMINI
  if (ai && process.env.GEMINI_API_KEY) {
    try {
      const prompt = `Actúas como un motor forense de ciberseguridad. Analiza si la URL y el texto presentan phishing, ingeniería social o fraude. URL: ${currentUrl} Texto: "${textContent}"`;
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isThreat: { type: Type.BOOLEAN },
              score: { type: Type.INTEGER },
              threatType: { type: Type.STRING },
              reason: { type: Type.STRING },
            },
            required: ["isThreat", "score", "threatType", "reason"],
          },
        },
      });

      const securityReport = JSON.parse(response.text);

      // Si la Inteligencia Artificial confirma el peligro, se asienta en el historial relacional
      if (securityReport.isThreat && securityReport.score >= 60) {
        await db.run(
          `INSERT INTO historial (url, threat_type, reason, fecha, action) VALUES (?, ?, ?, ?, 'Bloqueado')`,
          [
            currentUrl,
            securityReport.threatType,
            securityReport.reason,
            fechaActual,
          ],
        );
      }

      return res.json(securityReport);
    } catch (error) {
      console.error("Fallo de API Key, enviando reporte preventivo.");
    }
  }

  res.json({ isThreat: false, score: 0, threatType: "", reason: "" });
});

// 🗂️ NUEVO ENDPOINT: CONSULTAR HISTORIAL DESDE REACT
app.get("/api/history", async (req, res) => {
  try {
    // Traemos los últimos 10 ataques registrados de la base de datos
    const listaHistorial = await db.all(
      "SELECT * FROM historial ORDER BY id DESC LIMIT 10",
    );
    res.json(listaHistorial);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error consultando el historial relacional." });
  }
});

// NUEVO ENDPOINT: ACTUALIZAR ACCIÓN (Si el usuario decide ignorar la alerta opcional)
app.post("/api/history/update-action", async (req, res) => {
  const { url } = req.body;
  try {
    await db.run(
      `UPDATE historial SET action = 'Ingresado (Riesgo)' WHERE url = ? ORDER BY id DESC LIMIT 1`,
      [url],
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar la acción." });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Servidor con Base de Datos e Historial en puerto ${PORT}`),
);
