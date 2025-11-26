// Function to load a component (HTML snippet) into a target element
function loadComponent(targetElementId, componentFile) {
    const targetElement = document.getElementById(targetElementId);

    // Use the Fetch API to get the component content
    fetch(componentFile)
        .then(response => {
            // Check if the file was found
            if (!response.ok) {
                throw new Error(`Could not load ${componentFile}: ${response.statusText}`);
            }
            return response.text();
        })
        .then(data => {
            // Inject the HTML content into the target element
            targetElement.innerHTML = data;
        })
        .catch(error => {
            console.error('Error loading component:', error);
            targetElement.innerHTML = `Error: Could not load ${componentFile}.`;
        });
}

function loadAuthComponent() {
    // Placeholder check: Assume logged out unless a session flag is found
    const isLoggedIn = localStorage.getItem('isUserLoggedIn') === 'true';
    
    let authComponentPath;
    
    if (isLoggedIn) {
        // If logged in, load the welcome/logout component
        authComponentPath = '/components/auth-logged-in.html';
        
        // Load the component and pass the logout logic as a callback
        loadComponent('auth-component-placeholder', authComponentPath, () => {
            // This code runs *after* auth-logged-in.html is injected
            const logoutLink = document.getElementById('logout-link');

            if (logoutLink) {
                logoutLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    
                    // Clear client-side flags
                    localStorage.removeItem('isUserLoggedIn');
                    localStorage.removeItem('username');
                    
                    // Call the logout API to expire the HTTP-only cookie
                    fetch('/api/logout', { method: 'POST' })
                        .then(() => {
                            // After successfully expiring the cookie, redirect to the home page
                            window.location.href = '/index.html'; 
                        })
                        .catch(error => {
                            console.error('Logout error:', error);
                            // Fallback: force redirect even on error
                            window.location.href = '/index.html';
                        });
                });
            }
        });

    } else {
        // If logged out, load the login/register component
        authComponentPath = '/components/auth-logged-out.html';
        // Load the selected component into the placeholder
        loadComponent('auth-component-placeholder', authComponentPath);
    }
}

// Load the components once the page structure is ready
document.addEventListener('DOMContentLoaded', () => {
    loadComponent('navbar-placeholder', '/components/nav.html');
    loadComponent('footer-placeholder', '/components/footer.html');
    loadAuthComponent();
});