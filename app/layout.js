import "./globals.css";

export const metadata = {
  title: "Model Arena",
  description: "Compare small Hugging Face models side by side on your own prompts and grade them with Gemini.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
