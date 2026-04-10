export const authService = {
  login: async (login: string, pass: string) => {
    // Mock API call
    return new Promise((resolve) => setTimeout(resolve, 1000));
  }
};
