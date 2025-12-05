document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const errorMessage = document.getElementById('error-message');

    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            errorMessage.textContent = 'Logging in...';

            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email, password }),
                });

                const result = await response.json();

                if (response.ok) {
                    errorMessage.textContent = '';
                    
                    localStorage.setItem('isUserLoggedIn', 'true');
                    localStorage.setItem('username', result.username);

                    window.location.href = '/index.html';

                } else {
                    errorMessage.textContent = result.message || 'Login failed. Please try again.';
                }
            } catch (error) {
                console.error('Network or API connection error:', error);
                errorMessage.textContent = 'A network error occurred. Please check your connection.';
            }
        });
    }

});