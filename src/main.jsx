import React from "react";
import ReactDOM from "react-dom/client";

const ExpenseLedger = React.lazy(() => import("../ExpenseLedger.jsx"));

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.Suspense fallback={<div style={{padding:"2rem"}}>Loading…</div>}>
    <ExpenseLedger />
  </React.Suspense>
);
