const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const http = require('http'); // Required for WebSocket
const { Server } = require('socket.io');
const session = require('express-session');

const app = express();
const port = 3000;

// Create HTTP and Socket.IO server
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*', // Allow all origins
        methods: ['GET', 'POST'], // Allow specific HTTP methods
        credentials: true, // Allow credentials (cookies, etc.)
    },
});


// Explicitly handle OPTIONS requests
app.options('*', cors());



const markersFile = 'markers.json';

// Enable CORS for all origins
app.use(express.json());
app.use('/pictures', express.static(path.join(__dirname, 'pictures')));

// Ensure the markers file exists
if (!fs.existsSync(markersFile)) {
    fs.writeFileSync(markersFile, JSON.stringify([]));
}

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'pictures/');
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    },
});
const upload = multer({ storage });

// Helper function to read markers file
function readMarkersFile() {
    try {
        return JSON.parse(fs.readFileSync(markersFile, 'utf8'));
    } catch (err) {
        console.error('Error reading markers file:', err);
        return [];
    }
}

// Helper function to write to markers file
function writeMarkersFile(data) {
    try {
        fs.writeFileSync(markersFile, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error writing to markers file:', err);
    }
}

// Endpoint to fetch all markers
app.get('/markers', (req, res) => {
    try {
        const data = readMarkersFile();
        res.json(data);
    } catch (err) {
        console.error('Error reading markers:', err);
        res.status(500).send('Error fetching markers');
    }
});

// Endpoint to save or update a marker
app.post('/markers', (req, res) => {
    try {
        const newMarker = req.body;
        const markers = readMarkersFile();

        const existingIndex = markers.findIndex((m) => m.id === newMarker.id);

        if (existingIndex !== -1) {
            markers[existingIndex] = newMarker;
        } else {
            markers.push(newMarker);
        }

        writeMarkersFile(markers);
        io.emit('marker-updated', markers); // Notify all clients
        res.json({ success: true });
    } catch (err) {
        console.error('Error saving marker:', err);
        res.status(500).send('Error saving marker');
    }
});

// Endpoint to delete a marker by ID
app.delete('/markers/:id', (req, res) => {
    try {
        const markerId = req.params.id;
        const markers = readMarkersFile();

        const markerToDelete = markers.find((m) => m.id === markerId);

        if (!markerToDelete) {
            return res.status(404).json({ error: 'Marker not found' });
        }

        // Delete associated photos
        if (markerToDelete.photos) {
            markerToDelete.photos.forEach((photo) => {
                const photoPath = path.join(__dirname, 'pictures', photo);
                if (fs.existsSync(photoPath)) {
                    fs.unlinkSync(photoPath);
                }
            });
        }

        // Update the markers file
        const updatedMarkers = markers.filter((m) => m.id !== markerId);
        writeMarkersFile(updatedMarkers);

        io.emit('marker-updated', updatedMarkers); // Notify all clients
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting marker:', err);
        res.status(500).send('Error deleting marker');
    }
});

app.post('/upload/:id', upload.array('photos', 10), (req, res) => {
    const markerId = req.params.id; // Get marker ID from the URL
    const uploadedFiles = req.files.map((file) => file.filename); // Get the filenames of uploaded photos

    try {
        const markers = readMarkersFile(); // Read the existing markers
        const markerIndex = markers.findIndex((m) => m.id === markerId);

        if (markerIndex !== -1) {
            // If the marker exists, append the uploaded photos
            const existingPhotos = markers[markerIndex].photos || [];
            const newPhotos = [...existingPhotos, ...uploadedFiles];

            // Update the marker's photos
            markers[markerIndex].photos = newPhotos;
            writeMarkersFile(markers); // Save the updated markers to markers.json

            // Emit the updated markers to all connected clients
            io.emit('marker-updated', markers);

            // Respond with success and the updated photo list
            res.json({ success: true, photos: newPhotos });
        } else {
            // If the marker doesn't exist, return an error
            res.status(404).json({ error: 'Marker not found' });
        }
    } catch (err) {
        console.error('Error uploading photos:', err);
        res.status(500).send('Error uploading photos');
    }
});


app.delete('/photos/:markerId/:photo', (req, res) => {
    const { markerId, photo } = req.params;

    try {
        const markers = readMarkersFile();
        const markerIndex = markers.findIndex((m) => m.id === markerId);

        if (markerIndex === -1) {
            return res.status(404).json({ error: 'Marker not found' });
        }

        const marker = markers[markerIndex];
        const updatedPhotos = marker.photos.filter((p) => p !== photo);

        // Update the marker photos
        markers[markerIndex].photos = updatedPhotos;

        // Delete the photo from the filesystem
        const photoPath = path.join(__dirname, 'pictures', photo);
        if (fs.existsSync(photoPath)) {
            fs.unlinkSync(photoPath);
        }

        writeMarkersFile(markers);
        io.emit('marker-updated', markers); // Notify all clients

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting photo:', err);
        res.status(500).send('Error deleting photo');
    }
});

// Enable session middleware
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to true if using HTTPS
}));

// Middleware to check if user is logged in
app.use('/index.html', (req, res, next) => {
    if (req.session.isLoggedIn) {
        return next(); // Allow access
    }
    res.redirect('/login.html'); // Redirect to login page
});

// Login endpoint
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    // Simple authentication check
    if (username === 'admin' && password === 'password123') {
        req.session.isLoggedIn = true;
        return res.json({ success: true });
    }

    res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// Logout endpoint
app.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// WebSocket connection
io.on('connection', (socket) => {
    console.log('A user connected.');

    // Send all markers to the connected user
    socket.emit('marker-updated', readMarkersFile());

    socket.on('disconnect', () => {
        console.log('A user disconnected.');
    });
});

io.on('marker-updated', (markers) => {
    // Remove all existing markers
    markersMap.forEach((marker, markerId) => {
        map.removeLayer(marker);
        markersMap.delete(markerId);
    });

    // Add updated markers
    markers.forEach((markerData) => {
        createMarker(
            { lat: markerData.lat, lng: markerData.lng },
            markerData.iconUrl,
            markerData.id,
            markerData.info
        );
    });
});

io.on('marker-deleted', (markerId) => {
    const marker = markersMap.get(markerId);
    if (marker) {
        map.removeLayer(marker);
        markersMap.delete(markerId);
    }
});


