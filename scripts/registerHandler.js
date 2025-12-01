document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.getElementById('register-form');
    const statusMessage = document.getElementById('status-message');

    if (registerForm) {
        registerForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            statusMessage.textContent = 'Processing registration...';
            statusMessage.style.color = 'orange';

            const username = document.getElementById('username').value;
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirm-password').value;

            // 1. Client-side validation: Check if passwords match
            if (password !== confirmPassword) {
                statusMessage.textContent = 'Error: Passwords do not match.';
                statusMessage.style.color = 'red';
                return;
            }

            try {
                // 2. Send data to the Vercel Serverless Function
                const response = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, email, password }),
                });

                const result = await response.json();

                if (response.ok) {
                    // Registration successful!
                    statusMessage.textContent = 'Success! Account created. Redirecting to login...';
                    statusMessage.style.color = 'green';
                    
                    // 3. Redirect to the login page after a short delay
                    setTimeout(() => {
                        window.location.href = '/pages/auth/login.html';
                    }, 1500); 

                } else {
                    // Registration failed (e.g., 409 Email/Username already in use)
                    statusMessage.textContent = result.message || 'Registration failed. Please try again.';
                    statusMessage.style.color = 'red';
                }
            } catch (error) {
                console.error('Network or API connection error:', error);
                statusMessage.textContent = 'A network error occurred. Please check your connection.';
                statusMessage.style.color = 'red';
            }
        });
    }
});