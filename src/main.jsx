import React from "react";
import ReactDOM from "react-dom/client";

async function init() {
  const { default: ExpenseLedger } = await import("../ExpenseLedger.jsx");
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <ExpenseLedger />
    </React.StrictMode>
  );
}

init();
