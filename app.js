document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    // Hardcoded credentials
    const hardcodedUsername = 'admin';
    const hardcodedPassword = 'password123';

    if (username === hardcodedUsername && password === hardcodedPassword) {
        // Store login status in sessionStorage
        sessionStorage.setItem('loggedIn', 'true');
        // Redirect to the map page
        window.location.href = 'index.html';
    } else {
        // Display error message
        document.getElementById('error-message').textContent = 'Invalid username or password.';
    }
});
