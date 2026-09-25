// Escucha los mensajes internos que envía el escáner de la pantalla
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analizar_texto") {
    // AQUÍ ESTÁ EL PUERTO 5000 Y EL ENDPOINT CORRECTOS
    fetch("http://127.0.0.1:5000/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        textContent: request.textContent,
        currentUrl: request.currentUrl,
      }),
    })
      .then((response) => {
        if (!response.ok)
          throw new Error("Error en respuesta de red del servidor");
        return response.json();
      })
      .then((data) => sendResponse({ success: true, data: data }))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true; // Mantiene abierto el canal de comunicación de forma asíncrona
  }
});
