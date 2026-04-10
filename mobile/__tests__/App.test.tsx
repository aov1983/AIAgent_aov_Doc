import React from 'react';
import { render, screen } from '@testing-library/react-native';
import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import DocumentUploadScreen from '../screens/DocumentUploadScreen';
import AnalysisResultsScreen from '../screens/AnalysisResultsScreen';

// Mock navigation
const mockNavigation = {
  navigate: jest.fn(),
  replace: jest.fn(),
  goBack: jest.fn(),
};

const mockRoute = {
  params: {
    documentId: 'test-doc-123',
    report: null,
  },
};

describe('LoginScreen', () => {
  it('renders login form correctly', () => {
    render(<LoginScreen navigation={mockNavigation as any} />);
    expect(screen.getByText('AI Architect')).toBeTruthy();
    expect(screen.getByPlaceholderText('Логин')).toBeTruthy();
    expect(screen.getByText('Войти')).toBeTruthy();
  });
});

describe('HomeScreen', () => {
  it('renders main menu items', () => {
    render(<HomeScreen navigation={mockNavigation as any} />);
    expect(screen.getByText('Добро пожаловать!')).toBeTruthy();
    expect(screen.getByText('Загрузка документа')).toBeTruthy();
  });
});

describe('DocumentUploadScreen', () => {
  it('renders upload interface', () => {
    render(<DocumentUploadScreen navigation={mockNavigation as any} />);
    expect(screen.getByText('Загрузка документа')).toBeTruthy();
  });
});

describe('AnalysisResultsScreen', () => {
  it('renders analysis results', () => {
    render(<AnalysisResultsScreen route={mockRoute as any} navigation={mockNavigation as any} />);
    expect(screen.getByText('Результаты анализа')).toBeTruthy();
  });
});
