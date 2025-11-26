document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const errorMessage = document.getElementById('error-message');

    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault(); // Stop the default form submission

            errorMessage.textContent = 'Logging in...';

            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {
                // Send credentials to the Vercel Serverless Function
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email, password }),
                });

                const result = await response.json();

                if (response.ok) {
                    // Login successful!
                    errorMessage.textContent = ''; // Clear status
                    
                    // The JWT is automatically saved as a cookie by the browser.
                    // Now, set the necessary client-side flags and redirect.
                    localStorage.setItem('isUserLoggedIn', 'true');
                    
                    // Store the username (sent back from the API) to display in the header component
                    localStorage.setItem('username', result.username);

                    // Redirect to the home page
                    window.location.href = '/index.html';

                } else {
                    // Login failed (e.g., 401 Invalid credentials, 400 Missing fields)
                    errorMessage.textContent = result.message || 'Login failed. Please try again.';
                }
            } catch (error) {
                console.error('Network or API connection error:', error);
                errorMessage.textContent = 'A network error occurred. Please check your connection.';
            }
        });
    }

    const logoutLink = document.getElementById('logout-link');

    if (logoutLink) {
        logoutLink.addEventListener('click', async function(e) {
            e.preventDefault();

            try {
                // 1. Call the Serverless Function to destroy the secure HTTP-only cookie
                const response = await fetch('/api/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                });

                if (response.ok) {
                    // 2. Client-side cleanup
                    localStorage.removeItem('isUserLoggedIn');
                    localStorage.removeItem('username');
                    
                    // 3. Redirect
                    window.location.href = '/index.html'; 
                } else {
                    alert('Logout failed on the server. Please try again.');
                }
            } catch (error) {
                console.error('Network error during logout:', error);
                alert('A network error occurred during logout.');
            }
        });
    }
});