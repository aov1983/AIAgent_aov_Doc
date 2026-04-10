/**
 * UNIT Тесты для мобильных компонентов (React Native)
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import LoginScreen from '../src/screens/LoginScreen';
import DocumentUploadScreen from '../src/screens/DocumentUploadScreen';
import ResultsScreen from '../src/screens/ResultsScreen';

// Моки для навигации и API
jest.mock('@react-navigation/native', () => {
  const actualNav = jest.requireActual('@react-navigation/native');
  return {
    ...actualNav,
    useNavigation: () => ({
      navigate: jest.fn(),
      dispatch: jest.fn(),
    }),
  };
});

jest.mock('../src/services/api', () => ({
  login: jest.fn(),
  uploadDocument: jest.fn(),
  getAnalysisResults: jest.fn(),
}));

describe('LoginScreen', () => {
  it('renders correctly', () => {
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);
    
    expect(getByPlaceholderText(/username|логин/i)).toBeTruthy();
    expect(getByPlaceholderText(/password|пароль/i)).toBeTruthy();
    expect(getByText(/login|войти/i)).toBeTruthy();
  });

  it('shows error on invalid credentials', async () => {
    const { getByText, getByPlaceholderText } = render(<LoginScreen />);
    
    const usernameInput = getByPlaceholderText(/username/i);
    const passwordInput = getByPlaceholderText(/password/i);
    const loginButton = getByText(/login/i);

    fireEvent.changeText(usernameInput, 'invalid_user');
    fireEvent.changeText(passwordInput, 'wrong_password');
    fireEvent.press(loginButton);

    await waitFor(() => {
      expect(getByText(/invalid credentials|ошибка входа/i)).toBeTruthy();
    });
  });

  it('navigates on successful login', async () => {
    const { getByText, getByPlaceholderText } = render(<LoginScreen />);
    const { login } = require('../src/services/api');
    
    login.mockResolvedValue({ token: 'fake_token', role: 'architect' });

    const usernameInput = getByPlaceholderText(/username/i);
    const passwordInput = getByPlaceholderText(/password/i);
    const loginButton = getByText(/login/i);

    fireEvent.changeText(usernameInput, 'architect');
    fireEvent.changeText(passwordInput, 'admin');
    fireEvent.press(loginButton);

    await waitFor(() => {
      const { useNavigation } = require('@react-navigation/native');
      expect(useNavigation().navigate).toHaveBeenCalledWith('Main');
    });
  });
});

describe('DocumentUploadScreen', () => {
  it('renders upload button and file list', () => {
    const { getByText } = render(<DocumentUploadScreen />);
    
    expect(getByText(/upload|загрузить/i)).toBeTruthy();
    expect(getByText(/select file|выбрать файл/i)).toBeTruthy();
  });

  it('handles file upload successfully', async () => {
    const { getByText } = render(<DocumentUploadScreen />);
    const { uploadDocument } = require('../src/services/api');
    
    uploadDocument.mockResolvedValue({ document_id: '123', status: 'uploaded' });

    const uploadButton = getByText(/upload/i);
    fireEvent.press(uploadButton);

    await waitFor(() => {
      expect(uploadDocument).toHaveBeenCalled();
    });
  });
});

describe('ResultsScreen', () => {
  const mockResults = {
    chapters: [
      {
        title: 'Глава 1',
        sections: [
          {
            title: 'Раздел 1.1',
            paragraphs: [
              {
                text: 'Текст абзаца',
                atoms: [{
                  fact: 'Факт 1',
                  risk: 'Риск 1',
                  criticality: 'Высокий',
                  recommendation: 'Рекомендация 1',
                  roles: ['architect'],
                  similarity: 0.85
                }]
              }
            ]
          }
        ]
      }
    ]
  };

  it('renders analysis results', () => {
    const { getByText } = render(<ResultsScreen route={{ params: { results: mockResults } }} />);
    
    expect(getByText(/Глава 1/i)).toBeTruthy();
    expect(getByText(/Раздел 1.1/i)).toBeTruthy();
    expect(getByText(/Факт 1/i)).toBeTruthy();
  });

  it('displays similarity badges correctly', () => {
    const { getByText } = render(<ResultsScreen route={{ params: { results: mockResults } }} />);
    
    // Проверка отображения процента схожести
    expect(getByText(/85%|0.85/i)).toBeTruthy();
  });

  it('allows navigation to similar documents', () => {
    const { getByText } = render(<ResultsScreen route={{ params: { results: mockResults } }} />);
    const { useNavigation } = require('@react-navigation/native');

    // Имитация нажатия на ссылку похожего документа
    const similarityLink = getByText(/85%|похожие/i);
    fireEvent.press(similarityLink);

    expect(useNavigation().navigate).toHaveBeenCalledWith(
      'SimilarDocuments',
      expect.any(Object)
    );
  });
});

// Snapshot тесты
describe('Snapshots', () => {
  it('LoginScreen snapshot', () => {
    const tree = render(<LoginScreen />).toJSON();
    expect(tree).toMatchSnapshot();
  });

  it('DocumentUploadScreen snapshot', () => {
    const tree = render(<DocumentUploadScreen />).toJSON();
    expect(tree).toMatchSnapshot();
  });
});
