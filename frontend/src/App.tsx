import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  Menu,
  MenuItem,
  Divider,
  FormControl,
  Select,
  Button,
} from '@mui/material';
import {
  Menu as MenuIcon,
  CloudUpload as UploadIcon,
  FolderOpen as HistoryIcon,
  Search as SearchIcon,
  Logout as LogoutIcon,
  AccountCircle,
  Chat as ChatIcon,
  Assignment as AssignmentIcon,
  ListAlt as ListAltIcon,
  Workspaces as ProjectsIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { useAuth } from './hooks/useAuth';
import { ProjectProvider, useProject } from './hooks/useProject';
import { LoginPage } from './pages/LoginPage';
import { FileUploadPage } from './pages/FileUploadPage';
import { FileHistoryPage } from './pages/FileHistoryPage';
import { SearchPage } from './pages/SearchPage';
import { ChatPage } from './pages/ChatPage';
import { RequirementsPage } from './pages/RequirementsPage';
import { RequirementsRegistryPage } from './pages/RequirementsRegistryPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import type { User } from './types';

const DRAWER_WIDTH = 240;

// Глобальный селектор активного проекта в шапке. Интерфейс привязан к одному проекту: списки
// документов, требования, реестр, чат и RAG-поиск показывают только его документы (см. useProject).
function ProjectSelector() {
  const { projects, currentProjectId, setCurrentProjectId, loading } = useProject();

  if (loading) return null;

  // Краевой случай строгой модели: проектов ещё нет — выбирать нечего, ведём в раздел «Проекты».
  if (projects.length === 0) {
    return (
      <Button
        component={RouterLink}
        to="/projects"
        size="small"
        startIcon={<AddIcon />}
        sx={{ color: 'inherit', borderColor: 'rgba(255,255,255,0.5)' }}
        variant="outlined"
      >
        Создать проект
      </Button>
    );
  }

  return (
    <FormControl size="small" sx={{ minWidth: 200 }}>
      <Select
        value={currentProjectId}
        onChange={(e) => setCurrentProjectId(e.target.value as string)}
        variant="standard"
        disableUnderline
        startAdornment={<ProjectsIcon sx={{ mr: 1, fontSize: 20, opacity: 0.9 }} />}
        sx={{
          color: 'inherit',
          fontWeight: 600,
          '& .MuiSelect-icon': { color: 'inherit' },
          '& .MuiSelect-select': { py: 0.5 },
        }}
      >
        {projects.map((p) => (
          <MenuItem key={p.project_id} value={p.project_id}>
            {p.name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

// Авторизованная оболочка приложения. Обёрнута в ProjectProvider (он грузит проекты/документы по
// авторизованному API), поэтому вынесена из App, где идёт гейт по наличию пользователя.
function AuthedShell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleDrawerToggle = () => setMobileOpen(!mobileOpen);
  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const handleMenuClose = () => setAnchorEl(null);
  const handleLogout = () => {
    onLogout();
    handleMenuClose();
  };

  const menuItems = [
    { text: 'Загрузка файла', icon: <UploadIcon />, path: '/upload' },
    { text: 'История файлов', icon: <HistoryIcon />, path: '/history' },
    { text: 'Проекты', icon: <ProjectsIcon />, path: '/projects' },
    { text: 'Требования', icon: <AssignmentIcon />, path: '/requirements' },
    { text: 'Реестр требований', icon: <ListAltIcon />, path: '/requirements-registry' },
    { text: 'Поиск в RAG', icon: <SearchIcon />, path: '/search' },
    { text: 'Чат по документам', icon: <ChatIcon />, path: '/chat' },
  ];

  const drawer = (
    <Box>
      <Toolbar>
        <Typography variant="h6" noWrap component="div" sx={{ fontWeight: 'bold' }}>
          AI Architect
        </Typography>
      </Toolbar>
      <Divider />
      <List>
        {menuItems.map((item) => (
          <ListItem key={item.text} disablePadding>
            <ListItemButton component={RouterLink} to={item.path} onClick={() => setMobileOpen(false)}>
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );

  return (
    <Router>
      <Box sx={{ display: 'flex' }}>
        <AppBar
          position="fixed"
          sx={{
            width: { sm: `calc(100% - ${DRAWER_WIDTH}px)` },
            ml: { sm: `${DRAWER_WIDTH}px` },
          }}
        >
          <Toolbar>
            <IconButton
              color="inherit"
              edge="start"
              onClick={handleDrawerToggle}
              sx={{ mr: 2, display: { sm: 'none' } }}
            >
              <MenuIcon />
            </IconButton>
            <ProjectSelector />
            <Box sx={{ flexGrow: 1 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' } }}>
                {user.username} ({user.role})
              </Typography>
              <IconButton onClick={handleMenuOpen} size="small">
                <Avatar sx={{ width: 32, height: 32, bgcolor: 'secondary.main' }}>
                  {user.username[0].toUpperCase()}
                </Avatar>
              </IconButton>
            </Box>
          </Toolbar>
        </AppBar>

        <Box component="nav" sx={{ width: { sm: DRAWER_WIDTH }, flexShrink: { sm: 0 } }}>
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={handleDrawerToggle}
            ModalProps={{ keepMounted: true }}
            sx={{
              display: { xs: 'block', sm: 'none' },
              '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH },
            }}
          >
            {drawer}
          </Drawer>
          <Drawer
            variant="permanent"
            sx={{
              display: { xs: 'none', sm: 'block' },
              '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH },
            }}
            open
          >
            {drawer}
          </Drawer>
        </Box>

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: 3,
            width: { sm: `calc(100% - ${DRAWER_WIDTH}px)` },
            mt: 8,
          }}
        >
          <Routes>
            <Route path="/upload" element={<FileUploadPage userRole={user.role} />} />
            <Route path="/history" element={<FileHistoryPage />} />
            <Route path="/requirements" element={<RequirementsPage />} />
            <Route path="/requirements-registry" element={<RequirementsRegistryPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/" element={<Navigate to="/upload" replace />} />
          </Routes>
        </Box>

        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
          <MenuItem disabled>
            <AccountCircle sx={{ mr: 1 }} />
            {user.username}
          </MenuItem>
          <Divider />
          <MenuItem onClick={handleLogout}>
            <LogoutIcon sx={{ mr: 1 }} />
            Выйти
          </MenuItem>
        </Menu>
      </Box>
    </Router>
  );
}

function App() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Typography>Loading...</Typography>
      </Box>
    );
  }

  if (!user) {
    return <LoginPage onLoginSuccess={() => {}} />;
  }

  return (
    <ProjectProvider>
      <AuthedShell user={user} onLogout={logout} />
    </ProjectProvider>
  );
}

export default App;
