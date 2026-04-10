import axios from 'axios';

const API_URL = 'http://localhost:8000';

export default {
  async login(username: string, password: string) {
    const response = await axios.post(`${API_URL}/auth/login`, { username, password });
    if (response.data.token) {
      localStorage.setItem('token', response.data.token);
    }
    return response.data;
  },
  async logout() {
    localStorage.removeItem('token');
  }
};
