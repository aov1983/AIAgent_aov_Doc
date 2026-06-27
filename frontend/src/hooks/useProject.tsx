import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fileApi, projectsApi } from '../api';
import type { FileHistoryItem, Project } from '../types';

// Ключ localStorage для «активного проекта». Интерфейс привязан к одному выбранному проекту:
// списки документов, требования, реестр, чат и RAG-поиск показывают только его документы.
const STORAGE_KEY = 'current_project_id';

interface ProjectContextValue {
  projects: Project[];
  loading: boolean;
  // '' только когда проектов вообще нет (см. краевой случай в шапке/страницах).
  currentProjectId: string;
  currentProject: Project | null;
  setCurrentProjectId: (id: string) => void;
  // Перечитать список проектов (после создания/удаления/переименования) — чтобы селектор в шапке
  // оставался актуальным. Возвращает свежий список.
  reloadProjects: () => Promise<Project[]>;

  // Общий для приложения список ВСЕХ документов (источник для фильтрации по проекту и набора
  // document_id для RAG-поиска/чата). Грузится один раз, обновляется по reloadDocuments().
  documents: FileHistoryItem[];
  documentsLoading: boolean;
  reloadDocuments: () => Promise<FileHistoryItem[]>;

  // Документы активного проекта и их идентификаторы (для includeDocumentIds в RAG).
  currentDocuments: FileHistoryItem[];
  currentDocumentIds: string[];
}

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<FileHistoryItem[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [currentProjectId, setCurrentProjectIdState] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) || '',
  );

  const setCurrentProjectId = useCallback((id: string) => {
    setCurrentProjectIdState(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const reloadProjects = useCallback(async (): Promise<Project[]> => {
    const data = await projectsApi.list();
    const list = Array.isArray(data) ? data : [];
    setProjects(list);
    // Поддерживаем инвариант «активный проект существует»: если сохранённого id нет в списке
    // (проект удалён / первый запуск) — выбираем первый доступный. Пустая строка = проектов нет.
    setCurrentProjectIdState((prev) => {
      const valid = prev && list.some((p) => p.project_id === prev);
      const next = valid ? prev : list[0]?.project_id || '';
      if (next) localStorage.setItem(STORAGE_KEY, next);
      else localStorage.removeItem(STORAGE_KEY);
      return next;
    });
    return list;
  }, []);

  const reloadDocuments = useCallback(async (): Promise<FileHistoryItem[]> => {
    const data = await fileApi.getHistory();
    const list = Array.isArray(data) ? data : [];
    setDocuments(list);
    return list;
  }, []);

  useEffect(() => {
    reloadProjects().finally(() => setLoading(false));
    reloadDocuments().finally(() => setDocumentsLoading(false));
  }, [reloadProjects, reloadDocuments]);

  const currentProject = useMemo(
    () => projects.find((p) => p.project_id === currentProjectId) || null,
    [projects, currentProjectId],
  );

  const currentDocuments = useMemo(
    () => (currentProjectId ? documents.filter((d) => d.project_id === currentProjectId) : []),
    [documents, currentProjectId],
  );

  const currentDocumentIds = useMemo(
    () => currentDocuments.map((d) => d.document_id),
    [currentDocuments],
  );

  const value: ProjectContextValue = {
    projects,
    loading,
    currentProjectId,
    currentProject,
    setCurrentProjectId,
    reloadProjects,
    documents,
    documentsLoading,
    reloadDocuments,
    currentDocuments,
    currentDocumentIds,
  };

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error('useProject must be used within ProjectProvider');
  }
  return ctx;
}
