export const metadata = {
  title: "DJ Trading Advisor",
  description: "Análisis de compra/venta del Dow Jones con datos de Massive y Claude AI",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, padding: 0, fontFamily: "system-ui, sans-serif", background: "#0f0f0f", color: "#e8e8e8" }}>
        {children}
      </body>
    </html>
  );
}
