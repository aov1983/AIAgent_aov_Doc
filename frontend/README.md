# AI Architect Agent - Frontend

React SPA frontend for AI Architect Agent with Material Design.

## Quick Start

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env if needed (default: http://localhost:8000)
```

### 3. Start Backend API

First, start the FastAPI backend:

```bash
cd ..
pip install -r api/requirements.txt
python -m uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Start Frontend

```bash
cd frontend
npm run dev
```

Open browser at: http://localhost:5173

## Features

### Authentication
- Role-based access control (Архитектор, Аналитик, Администратор, DevOps РП)
- Session management with localStorage
- Test credentials:
  - `architect` / `admin` (Full access)
  - `analyst` / `admin` (Upload & view)
  - `admin` / `admin` (Full access)

### File Upload & Analysis
- Drag-and-drop file upload (DOCX, DOC, TXT, PDF, MD)
- Real-time progress indicator
- Automatic document decomposition
- RAG similarity search integration

### Results Visualization
- Structured Markdown report display
- Similar requirements from RAG with similarity scores (%)
- Color-coded similarity badges:
  - 🔴 Red: >80% match (high similarity)
  - 🟡 Yellow: 60-80% match (medium similarity)
  - 🔵 Blue: <60% match (low similarity)

### File History
- List of processed documents
- Status tracking (completed, processing, failed)
- Quick access to file details

### RAG Search
- Full-text search across vector database
- Similarity threshold filtering
- Direct navigation to matching chunks

## Architecture

```
frontend/
├── src/
│   ├── api/          # REST API client (axios)
│   ├── components/   # Reusable UI components
│   ├── hooks/        # Custom React hooks (useAuth)
│   ├── pages/        # Page components
│   │   ├── LoginPage.tsx
│   │   ├── FileUploadPage.tsx
│   │   └── FileHistoryPage.tsx
│   ├── types/        # TypeScript interfaces
│   ├── App.tsx       # Main app with routing
│   └── main.tsx      # Entry point with MUI theme
├── package.json
├── tsconfig.json
├── vite.config.ts
└── index.html
```

## API Integration

The frontend communicates with the backend via REST API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | User authentication |
| `/api/upload` | POST | Upload document for analysis |
| `/api/reports/{id}` | GET | Get analysis report |
| `/api/rag/search` | GET | Search similar requirements |
| `/api/files/history` | GET | Get processed files list |

## Build for Production

```bash
npm run build
```

Output will be in `dist/` directory.

## Technology Stack

- **React 18** - UI library
- **TypeScript** - Type safety
- **Material-UI (MUI)** - Component library with Material Design
- **Vite** - Build tool and dev server
- **React Router** - Client-side routing
- **Axios** - HTTP client
- **React Markdown** - Markdown rendering
