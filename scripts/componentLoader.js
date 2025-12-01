// Function to load a component (HTML snippet) into a target element
// Function to load a component (HTML snippet) into a target element
// Added 'componentFile' to callback for context (though not strictly required for this fix)
function loadComponent(targetElementId, componentFile, callback) { 
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
            
            // Execute callback AFTER injection
            if (callback) {
                callback(componentFile); // Pass the file name
            }
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
        authComponentPath = '/components/auth-logged-in.html';
        
        // Pass the callback to loadComponent
        loadComponent('auth-component-placeholder', authComponentPath, () => {
            
            // --- LOGOUT LISTENER ATTACHMENT LOGIC ---
            const logoutLink = document.getElementById('logout-link');

            if (logoutLink) {
                console.log('✅ Logout link found. Attaching event listener.'); // ADD THIS TEST LOG
                
                logoutLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    
                    console.log('➡️ Logout button clicked! Initiating logout sequence.'); // ADD THIS TEST LOG
                    
                    // Clear client-side flags
                    localStorage.removeItem('isUserLoggedIn');
                    localStorage.removeItem('username');
                    
                    // Call the logout API to expire the HTTP-only cookie
                    fetch('/api/auth/logout', { method: 'POST' })
                        .then(() => {
                            // After successfully expiring the cookie, redirect
                            window.location.href = '/index.html'; 
                        })
                        .catch(error => {
                            console.error('Logout API Error:', error);
                            window.location.href = '/index.html';
                        });
                });
            } else {
                console.error('❌ Error: Logout link with ID "logout-link" not found after component load.');
            }
        });

    } else {
        authComponentPath = '/components/auth-logged-out.html';
        loadComponent('auth-component-placeholder', authComponentPath);
    }
}

// Load the components once the page structure is ready
document.addEventListener('DOMContentLoaded', () => {
    loadComponent('navbar-placeholder', '/components/nav.html');
    loadComponent('footer-placeholder', '/components/footer.html');
    loadAuthComponent();
});