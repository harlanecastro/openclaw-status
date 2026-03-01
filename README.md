# OpenClaw Status

O **OpenClaw Status** é uma aplicação de bandeja (System Tray) elegante construída com **Electron.js** para gerenciar e monitorar o status do seu Gateway [OpenClaw](https://openclaw.ai/) diretamente da área de trabalho do Windows.

## 🚀 Funcionalidades

- **Indicador Visual em Tempo Real**: O ícone na bandeja reage ao estado do seu gateway:
  - 🔴 **Vermelho**: Gateway Online.
  - ⚪ **Cinza**: Gateway Offline.
  - 🟠 **Laranja (piscando)**: Gateway processando ações (Iniciando, Parando, etc).
- **Gerenciamento Rápido**: Inicie, pare e reinicie o seu gateway com 1 clique (bloqueio contra comandos múltiplos incluído).
- **Tela de Logs Intuitiva**: Visualize as últimas saídas do servidor em uma tela nativa em dark mode, copie os logs rapidamente ou exclua os arquivos físicos de log para liberar espaço direto da interface.
- **Smart Context Menu**: O menu da bandeja exibe funcionalidades de acordo com a disponibilidade (você só pode abrir o "Dashboard" ou dar "Stop" se ele estiver rodando).
- **Health Check & Dashboard**: Verifica a saúde do serviço instantaneamente (com checagem TCP local de 1 segundo) e abre seu console web.
- **Multilíngue (i18n)**: Já traduzido nas opções PT e EN.

## 💻 Tecnologias

- [Electron](https://www.electronjs.org/)
- Node.js (Integrações com `child_process`, `fs`, `net`, `os`)
- Vanilla HTML / CSS / JS na interface
- Ícones em tempo real com processamento de imagem (`sharp`)

## 📋 Pré-requisitos

Para usar ou colaborar com o status tray, você precisa do [Node.js](https://nodejs.org/) instalado e a CLI oficial do OpenClaw acessível em seu sistema (o app invoca silenciosamente `openclaw gateway ...`).

## 🛠️ Como Iniciar (Desenvolvimento)

1. Clone o repositório em sua máquina:
```bash
git clone git@github.com:harlanecastro/openclaw-status.git
```
2. Acesse a pasta do projeto:
```bash
cd openclaw-status
```
3. Instale as dependências:
```bash
npm install
```
4. Execute o projeto:
```bash
npm start
```
Após executar, basta procurar o ícone do OpenClaw Status na área oculta da sua barra de tarefas do Windows.

## 🤝 Como Contribuir

Fique à vontade para reportar Issues e submeter Pull Requests!
1. Faça o *fork* do repositório
2. Crie uma branch para a sua feature (`git checkout -b feature/minhamudanca`)
3. Faça commit das mudanças (`git commit -m 'feat: minha nova feature'`)
4. Empurre a branch (`git push origin feature/minhamudanca`)
5. Abra um *Pull Request*
