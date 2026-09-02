import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.innerHTML = `
    <h1>问道长生 · 内容编辑器</h1>
    <p>施工中——内容表单、schema 校验与批量生成将在后续版本接入。</p>
  `;
}
