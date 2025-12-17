function loadComponent(targetElementId, componentFile, callback) { 
    const targetElement = document.getElementById(targetElementId);

    fetch(componentFile)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Could not load ${componentFile}: ${response.statusText}`);
            }
            return response.text();
        })
        .then(data => {
            targetElement.innerHTML = data;
            
            if (callback) {
                callback(componentFile);
            }
        })
        .catch(error => {
            console.error('Error loading component:', error);
            targetElement.innerHTML = `Error: Could not load ${componentFile}.`;
        });
}

function loadAuthComponent() {
    let isLoggedIn = localStorage.getItem('isUserLoggedIn') === 'true';

    const loggedInPath = '/components/auth-logged-in.html';
    const loggedOutPath = '/components/auth-logged-out.html';

    const performClientLogout = () => {
        console.log('Session expired. Cleaning up...');
        localStorage.removeItem('isUserLoggedIn');
        localStorage.removeItem('username');
        loadComponent('auth-component-placeholder', loggedOutPath); 
    };

    if (isLoggedIn) {
        fetch('/api/auth/login')
            .then(response => {
                if (response.status === 401) {
                    performClientLogout();
                    return; 
                }
                loadLoggedInUI();
            })
            .catch(err => {
                console.error("Session check failed:", err);
                loadLoggedInUI();
            });
    } else {
        loadComponent('auth-component-placeholder', loggedOutPath);
    }

    function loadLoggedInUI() {
        loadComponent('auth-component-placeholder', '/components/auth-logged-in.html', () => {
            setupLogoutListener();
        });

        loadComponent('click-game-placeholder', '/components/click-game.html', () => {
            initializeClickGame();
        });
    }

    function initializeClickGame() {
        const clickImg = document.getElementById('game-click-image');
        const display = document.getElementById('click-count');
        
        fetch('/api/clicks')
            .then(res => res.json())
            .then(data => {
                display.textContent = data.clicks || 0;
            })
            .catch(err => console.error("Failed to load clicks", err));

        clickImg.addEventListener('click', async () => {
            let currentClicks = parseInt(display.textContent);
            display.textContent = currentClicks + 1;

            try {
                const response = await fetch('/api/clicks', { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const result = await response.json();
                display.textContent = result.clicks;
            } catch (error) {
                console.error("Error saving click:", error);
            }
        });
    }

    function setupLogoutListener() {
        const logoutLink = document.getElementById('logout-link');
        if (logoutLink) {
            logoutLink.addEventListener('click', (e) => {
                e.preventDefault();
                localStorage.removeItem('isUserLoggedIn');
                localStorage.removeItem('username');
                fetch('/api/auth/logout', { method: 'POST' })
                    .then(() => { window.location.href = '/index.html'; });
            });
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadComponent('navbar-placeholder', '/components/nav.html');
    loadComponent('footer-placeholder', '/components/footer.html');
    loadAuthComponent();
});