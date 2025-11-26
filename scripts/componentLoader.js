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

// Load the components once the page structure is ready
document.addEventListener('DOMContentLoaded', () => {
    // 1. Load the Navigation Bar (nav.html) into the nav#navbar-placeholder
    loadComponent('navbar-placeholder', '../components/nav.html');
    
    // 2. Load the Footer content (footer.html) into the p#footer-placeholder
    loadComponent('footer-placeholder', '../components/footer.html');
});