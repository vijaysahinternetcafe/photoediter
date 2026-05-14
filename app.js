document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const fileInput = document.getElementById('file-input');
    const btnUpload = document.getElementById('btn-upload');
    const canvasContainer = document.getElementById('canvas-container');
    const canvasPlaceholder = document.getElementById('canvas-placeholder');
    const uiCanvas = document.getElementById('ui-canvas');
    const ctx = uiCanvas.getContext('2d');
    const qualityWarning = document.getElementById('quality-warning');
    
    // Sliders & Values
    const sliders = {
        brightness: document.getElementById('slider-brightness'),
        contrast: document.getElementById('slider-contrast'),
        saturation: document.getElementById('slider-saturation'),
        sharpen: document.getElementById('slider-sharpen')
    };
    const vals = {
        brightness: document.getElementById('val-brightness'),
        contrast: document.getElementById('val-contrast'),
        saturation: document.getElementById('val-saturation'),
        sharpen: document.getElementById('val-sharpen')
    };

    // State
    let originalImage = null; // Stores the raw loaded image
    let currentImage = null; // Stores the cropped/processed base before filters
    let editHistory = {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        sharpen: 0
    };
    let isCropped = false;
    let cropRect = { x: 0, y: 0, w: 0, h: 0 };
    let a4CanvasData = null; // Stores the final generated sheet
    let isLayoutMode = false;
    let lastSingleImage = null;
    let lastSingleEdits = null;

    // Interactive Crop State
    let isInteractiveCropMode = false;
    let cropScale = 1;
    let cropX = 0;
    let cropY = 0;
    let isDraggingCrop = false;
    let dragStartX = 0;
    let dragStartY = 0;
    const passportRatio = 3.5 / 4.5;

    // Undo/Redo State
    let historyStack = [];
    let historyIndex = -1;

    // Settings
    let cafeSettings = {
        name: localStorage.getItem('cafeName') || 'My Cafe Center',
        price: localStorage.getItem('passportPrice') || '10'
    };
    document.getElementById('setting-cafe-name').value = cafeSettings.name;
    document.getElementById('setting-price').value = cafeSettings.price;

    const passportLayoutSelect = document.getElementById('passport-layout');
    const customLayoutQty = document.getElementById('custom-layout-qty');

    if (passportLayoutSelect && customLayoutQty) {
        passportLayoutSelect.addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                customLayoutQty.style.display = 'block';
            } else {
                customLayoutQty.style.display = 'none';
            }
        });
    }

    // --- Core Engine ---

    // Undo/Redo Engine
    function saveState() {
        if (!originalImage) return;
        
        // Remove future states if we undid and then made a new change
        if (historyIndex < historyStack.length - 1) {
            historyStack = historyStack.slice(0, historyIndex + 1);
        }
        
        historyStack.push({
            image: currentImage,
            isCropped: isCropped,
            edits: { ...editHistory },
            isLayoutMode: isLayoutMode,
            lastSingleImage: lastSingleImage,
            lastSingleEdits: lastSingleEdits ? { ...lastSingleEdits } : null
        });
        historyIndex++;
        updateUndoRedoButtons();
    }

    function updateUndoRedoButtons() {
        const btnUndo = document.getElementById('btn-undo');
        const btnRedo = document.getElementById('btn-redo');
        if (btnUndo) btnUndo.disabled = historyIndex <= 0;
        if (btnRedo) btnRedo.disabled = historyIndex >= historyStack.length - 1;
    }

    function restoreState(index) {
        if (index < 0 || index >= historyStack.length) return;
        
        const state = historyStack[index];
        currentImage = state.image;
        isCropped = state.isCropped;
        editHistory = { ...state.edits };
        isLayoutMode = state.isLayoutMode || false;
        lastSingleImage = state.lastSingleImage || null;
        lastSingleEdits = state.lastSingleEdits ? { ...state.lastSingleEdits } : null;
        
        Object.keys(sliders).forEach(key => {
            sliders[key].value = editHistory[key];
            vals[key].innerText = editHistory[key];
        });
        
        renderUI();
    }

    document.getElementById('btn-undo')?.addEventListener('click', () => {
        if (historyIndex > 0) {
            historyIndex--;
            restoreState(historyIndex);
            updateUndoRedoButtons();
        }
    });

    document.getElementById('btn-redo')?.addEventListener('click', () => {
        if (historyIndex < historyStack.length - 1) {
            historyIndex++;
            restoreState(historyIndex);
            updateUndoRedoButtons();
        }
    });

    // 1. Upload & Load Image
    btnUpload.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                originalImage = img;
                historyStack = [];
                historyIndex = -1;
                resetEdits(true);
                
                // Resolution Check (Warning if < 800px)
                if (img.width < 800 || img.height < 800) {
                    qualityWarning.style.display = 'flex';
                } else {
                    qualityWarning.style.display = 'none';
                }

                // Add listener to close warning manually
                document.getElementById('btn-close-warning')?.addEventListener('click', () => {
                    qualityWarning.style.display = 'none';
                });

                canvasPlaceholder.style.display = 'none';
                uiCanvas.style.display = 'block';
                
                updateWizard(2);
                renderUI();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });

    // 2. Render UI Canvas (Non-Destructive)
    function renderUI() {
        if (!currentImage) return;

        const rect = canvasContainer.getBoundingClientRect();
        
        if (isInteractiveCropMode) {
            uiCanvas.width = rect.width - 40;
            uiCanvas.height = rect.height - 40;
            
            ctx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
            ctx.save();
            applyContextFilters(ctx);
            
            ctx.translate(uiCanvas.width / 2 + cropX, uiCanvas.height / 2 + cropY);
            ctx.scale(cropScale, cropScale);
            ctx.drawImage(currentImage, -currentImage.width / 2, -currentImage.height / 2);
            ctx.restore();

            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(0, 0, uiCanvas.width, uiCanvas.height);

            let frameWidth = uiCanvas.width * 0.8;
            let frameHeight = frameWidth / passportRatio;
            if (frameHeight > uiCanvas.height * 0.8) {
                frameHeight = uiCanvas.height * 0.8;
                frameWidth = frameHeight * passportRatio;
            }

            const frameX = (uiCanvas.width - frameWidth) / 2;
            const frameY = (uiCanvas.height - frameHeight) / 2;

            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillRect(frameX, frameY, frameWidth, frameHeight);
            ctx.globalCompositeOperation = 'source-over';

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(frameX, frameY, frameWidth, frameHeight);
            ctx.setLineDash([]);
        } else {
            const ratio = Math.min((rect.width - 40) / currentImage.width, (rect.height - 40) / currentImage.height);
            uiCanvas.width = currentImage.width * ratio;
            uiCanvas.height = currentImage.height * ratio;
            applyContextFilters(ctx);
            ctx.drawImage(currentImage, 0, 0, uiCanvas.width, uiCanvas.height);
        }
    }

    // Generate Context Filters String
    function applyContextFilters(context) {
        const b = 100 + editHistory.brightness;
        const c = 100 + editHistory.contrast;
        const s = 100 + editHistory.saturation;
        // Simple sharp simulation using contrast + brightness offset
        context.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
    }

    // Handle Manual Sliders
    Object.keys(sliders).forEach(key => {
        sliders[key].addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            editHistory[key] = val;
            vals[key].innerText = val;
            renderUI();
        });
        sliders[key].addEventListener('change', () => {
            saveState();
        });
    });

    document.getElementById('btn-reset-edits').addEventListener('click', () => resetEdits(true));

    function resetEdits(shouldSave = true) {
        editHistory = { brightness: 0, contrast: 0, saturation: 0, sharpen: 0 };
        Object.keys(sliders).forEach(key => {
            sliders[key].value = 0;
            vals[key].innerText = 0;
        });
        currentImage = originalImage;
        isCropped = false;
        isLayoutMode = false;
        lastSingleImage = null;
        lastSingleEdits = null;
        renderUI();
        if (shouldSave) saveState();
    }

    // --- AI Magic Features ---
    document.querySelector('[data-action="auto-enhance"]').addEventListener('click', () => {
        if(!originalImage) return;
        setSliders({ brightness: 10, contrast: 15, saturation: 20, sharpen: 10 });
        updateWizard(3);
    });

    document.querySelector('[data-action="studio-photo"]').addEventListener('click', () => {
        if(!originalImage) return;
        setSliders({ brightness: 5, contrast: -5, saturation: -10, sharpen: 5 }); // Soften
        updateWizard(3);
    });

    document.querySelector('[data-action="cafe-menu"]').addEventListener('click', () => {
        if(!originalImage) return;
        setSliders({ brightness: 15, contrast: 20, saturation: 30, sharpen: 15 }); // Pop colors
        updateWizard(3);
    });

    function setSliders(newVals) {
        Object.keys(newVals).forEach(key => {
            editHistory[key] = newVals[key];
            sliders[key].value = newVals[key];
            vals[key].innerText = newVals[key];
        });
        renderUI();
        saveState();
    }

    // --- Print Studio ---
    
    // Auto Crop Passport
    document.getElementById('btn-make-passport').addEventListener('click', () => {
        if (!originalImage) return;
        
        isInteractiveCropMode = true;
        currentImage = originalImage;
        cropScale = 1;
        
        const rect = canvasContainer.getBoundingClientRect();
        const canvasW = rect.width - 40;
        const canvasH = rect.height - 40;
        
        let frameWidth = canvasW * 0.8;
        let frameHeight = frameWidth / passportRatio;
        if (frameHeight > canvasH * 0.8) {
            frameHeight = canvasH * 0.8;
            frameWidth = frameHeight * passportRatio;
        }

        const scaleX = frameWidth / originalImage.width;
        const scaleY = frameHeight / originalImage.height;
        cropScale = Math.max(scaleX, scaleY);
        
        cropX = 0;
        cropY = 0;

        document.getElementById('crop-actions').style.display = 'flex';
        uiCanvas.classList.add('crop-mode');
        renderUI();
    });

    uiCanvas.addEventListener('mousedown', (e) => {
        if (!isInteractiveCropMode) return;
        isDraggingCrop = true;
        dragStartX = e.clientX - cropX;
        dragStartY = e.clientY - cropY;
    });

    window.addEventListener('mousemove', (e) => {
        if (!isInteractiveCropMode || !isDraggingCrop) return;
        cropX = e.clientX - dragStartX;
        cropY = e.clientY - dragStartY;
        renderUI();
    });

    window.addEventListener('mouseup', () => {
        isDraggingCrop = false;
    });

    uiCanvas.addEventListener('wheel', (e) => {
        if (!isInteractiveCropMode) return;
        e.preventDefault();
        const zoomSensitivity = 0.001;
        cropScale -= e.deltaY * zoomSensitivity;
        if (cropScale < 0.05) cropScale = 0.05;
        if (cropScale > 10) cropScale = 10;
        renderUI();
    }, { passive: false });

    document.getElementById('btn-apply-crop').addEventListener('click', () => {
        if (!isInteractiveCropMode) return;

        const canvasW = uiCanvas.width;
        const canvasH = uiCanvas.height;
        
        let frameWidth = canvasW * 0.8;
        let frameHeight = frameWidth / passportRatio;
        if (frameHeight > canvasH * 0.8) {
            frameHeight = canvasH * 0.8;
            frameWidth = frameHeight * passportRatio;
        }

        const sourceW = frameWidth / cropScale;
        const sourceH = frameHeight / cropScale;
        const sourceX = (currentImage.width / 2) - (cropX / cropScale) - (sourceW / 2);
        const sourceY = (currentImage.height / 2) - (cropY / cropScale) - (sourceH / 2);

        const targetW = 600;
        const targetH = targetW / passportRatio;
        
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = targetW;
        tempCanvas.height = targetH;
        const tCtx = tempCanvas.getContext('2d');
        
        tCtx.drawImage(currentImage, sourceX, sourceY, sourceW, sourceH, 0, 0, targetW, targetH);

        const newImg = new Image();
        newImg.onload = () => {
            currentImage = newImg;
            isCropped = true;
            isInteractiveCropMode = false;
            isLayoutMode = false;
            document.getElementById('crop-actions').style.display = 'none';
            uiCanvas.classList.remove('crop-mode');
            renderUI();
            updateWizard(3);
            saveState();
        };
        newImg.src = tempCanvas.toDataURL('image/jpeg', 1.0);
    });

    document.getElementById('btn-cancel-crop').addEventListener('click', () => {
        isInteractiveCropMode = false;
        document.getElementById('crop-actions').style.display = 'none';
        uiCanvas.classList.remove('crop-mode');
        if (historyIndex >= 0) {
            restoreState(historyIndex);
        } else {
            resetEdits(false);
        }
    });

    // Generate A4 Sheet
    document.getElementById('btn-generate-sheet').addEventListener('click', () => {
        if (!currentImage) return;
        
        if (isLayoutMode && lastSingleImage) {
            // Revert to the single image to generate a fresh layout
            currentImage = lastSingleImage;
            editHistory = { ...lastSingleEdits };
        } else {
            // Save the single image state before generating layout
            lastSingleImage = currentImage;
            lastSingleEdits = { ...editHistory };
        }

        let count = parseInt(document.getElementById('passport-layout').value);
        if (document.getElementById('passport-layout').value === 'custom') {
            count = parseInt(document.getElementById('custom-layout-qty').value);
            if (!count || count < 1) {
                alert('Please enter a valid number of photos.');
                return;
            }
            if (count > 36) count = 36;
        }
        
        // High-res A4 at 300 DPI (2480 x 3508 pixels)
        const a4Width = 2480;
        const a4Height = 3508;
        
        const sheetCanvas = document.createElement('canvas');
        sheetCanvas.width = a4Width;
        sheetCanvas.height = a4Height;
        const sCtx = sheetCanvas.getContext('2d');
        
        // White Background
        sCtx.fillStyle = 'white';
        sCtx.fillRect(0, 0, a4Width, a4Height);

        // Render processed single image into high-res memory canvas
        const processCanvas = document.createElement('canvas');
        processCanvas.width = currentImage.width;
        processCanvas.height = currentImage.height;
        const pCtx = processCanvas.getContext('2d');
        applyContextFilters(pCtx);
        pCtx.drawImage(currentImage, 0, 0);

        // Passport size at 300 DPI (413 x 531)
        const pWidth = 380; // slightly scaled down to fit 6 in a row safely
        const pHeight = 488;
        const marginX = 25;
        const marginY = 40;

        let cols = 6; // Always 6 columns to match user expectations for 6, 12, 24, 32
        const totalGridWidth = (cols * pWidth) + ((cols - 1) * marginX);
        const startX = (a4Width - totalGridWidth) / 2;
        let x = startX;
        let y = 100;

        for (let i = 0; i < count; i++) {
            sCtx.drawImage(processCanvas, x, y, pWidth, pHeight);
            
            // Cut guidelines
            sCtx.strokeStyle = '#cccccc';
            sCtx.lineWidth = 2;
            sCtx.strokeRect(x, y, pWidth, pHeight);

            x += pWidth + marginX;
            if ((i + 1) % cols === 0) {
                x = startX;
                y += pHeight + marginY;
            }
        }

        // Branding removed to save ink as requested

        a4CanvasData = sheetCanvas;
        
        // Update UI
        const newImg = new Image();
        newImg.onload = () => {
            currentImage = newImg;
            isLayoutMode = true;
            
            // Reset sliders only, do NOT reset currentImage
            editHistory = { brightness: 0, contrast: 0, saturation: 0, sharpen: 0 };
            Object.keys(sliders).forEach(key => {
                sliders[key].value = 0;
                vals[key].innerText = 0;
            });
            
            renderUI();
            updateWizard(4);
            saveState();
        };
        newImg.src = sheetCanvas.toDataURL('image/jpeg', 0.8);
    });

    // --- Export & Print ---
    document.getElementById('btn-export-pdf').addEventListener('click', () => {
        if (!a4CanvasData) {
            alert('Please generate the A4 sheet first!');
            return;
        }
        
        try {
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });

            // Compress to 0.7 to avoid massive base64 string breaking the PDF
            const imgData = a4CanvasData.toDataURL('image/jpeg', 0.7);
            pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
            pdf.save('AI_Studio_Print.pdf');
        } catch (err) {
            alert('PDF Export failed. Please use "Save High-Res JPG" instead. ' + err.message);
        }
    });

    // Fallback: Save as JPG Button
    const btnSaveJpg = document.createElement('button');
    btnSaveJpg.className = 'btn btn-mega-primary mt-2';
    btnSaveJpg.innerHTML = '<i data-lucide="image"></i> Save High-Res JPG (फ़ोटो सेव)';
    btnSaveJpg.addEventListener('click', () => {
        if (!a4CanvasData) {
            alert('Please generate the A4 sheet first!');
            return;
        }
        const link = document.createElement('a');
        link.download = 'AI_Studio_Print.jpg';
        link.href = a4CanvasData.toDataURL('image/jpeg', 0.9);
        link.click();
    });
    // Insert after PDF button
    const pdfBtn = document.getElementById('btn-export-pdf');
    pdfBtn.parentNode.insertBefore(btnSaveJpg, pdfBtn.nextSibling);
    
    // Re-init icons for the new button
    lucide.createIcons();

    document.getElementById('btn-print').addEventListener('click', () => {
        if (!a4CanvasData) {
            alert('Please generate the A4 sheet first!');
            return;
        }
        
        const dataUrl = a4CanvasData.toDataURL('image/jpeg', 1.0);
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html>
                <head>
                    <title>Print Studio</title>
                    <style>
                        body { margin: 0; padding: 0; display: flex; justify-content: center; background: #555; }
                        img { width: 210mm; height: 297mm; display: block; background: white; box-shadow: 0 0 10px rgba(0,0,0,0.5); }
                        @media print {
                            @page { margin: 0; size: A4 portrait; }
                            body { margin: 0; background: white; }
                            img { box-shadow: none; }
                        }
                    </style>
                </head>
                <body>
                    <img src="${dataUrl}" onload="window.print(); window.close();" />
                </body>
            </html>
        `);
        printWindow.document.close();
    });

    // --- Utils & Modals ---
    function updateWizard(stepNum) {
        document.querySelectorAll('.wizard-steps .step').forEach((el, index) => {
            if (index < stepNum) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        });
    }

    // Tab Switching
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.getAttribute('data-target')).classList.add('active');
        });
    });

    // Theme Toggle
    document.getElementById('btn-theme-toggle').addEventListener('click', () => {
        const html = document.documentElement;
        html.setAttribute('data-theme', html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });

    // Settings Modal
    const modal = document.getElementById('settings-modal');
    document.getElementById('btn-service-mode').addEventListener('click', () => modal.classList.add('active'));
    document.getElementById('btn-close-settings').addEventListener('click', () => modal.classList.remove('active'));
    
    document.getElementById('btn-save-settings').addEventListener('click', (e) => {
        cafeSettings.name = document.getElementById('setting-cafe-name').value;
        cafeSettings.price = document.getElementById('setting-price').value;
        localStorage.setItem('cafeName', cafeSettings.name);
        localStorage.setItem('passportPrice', cafeSettings.price);
        
        // Non-blocking UI confirmation
        const btn = e.target;
        const oldText = btn.innerText;
        btn.innerText = 'Saved Successfully!';
        setTimeout(() => {
            btn.innerText = oldText;
            modal.classList.remove('active');
        }, 800);
    });
});
