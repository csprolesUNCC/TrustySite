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
    // --- THIS IS THE KEY LOGIC FOR DYNAMIC SWITCHING ---
    // In a real application, you would check a cookie, sessionStorage, 
    // or run an API call here.
    
    // Placeholder check: Assume logged out unless a session flag is found
    const isLoggedIn = localStorage.getItem('isUserLoggedIn') === 'true';
    
    let authComponentPath;
    
    if (isLoggedIn) {
        // If logged in, load the welcome/logout component
        authComponentPath = '/components/auth-logged-in.html';
    } else {
        // If logged out, load the login/register component
        authComponentPath = '/components/auth-logged-out.html';
    }
    
    // Load the selected component into the placeholder
    loadComponent('auth-component-placeholder', authComponentPath);
}

// Load the components once the page structure is ready
document.addEventListener('DOMContentLoaded', () => {
    loadComponent('navbar-placeholder', '/components/nav.html');
    loadComponent('footer-placeholder', '/components/footer.html');
    loadAuthComponent();
});