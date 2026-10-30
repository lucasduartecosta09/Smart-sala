/* Aplica o tema salvo ANTES de desenhar a página (evita piscar) */
try {
  const temaSalvo = localStorage.getItem("tema");
  document.documentElement.dataset.tema = temaSalvo === "claro" ? "claro" : "escuro";
} catch (e) {
  document.documentElement.dataset.tema = "escuro";
}
