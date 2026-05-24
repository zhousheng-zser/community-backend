const multer = require('multer');
const path = require('path');
const fs = require('fs');
const imageSize = require('image-size');

/** 入驻单图上限（与 nginx 对齐；超限请压缩） */
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** 小程序入驻专用路径 /upload/application */
const APPLICATION_MAX_BYTES = 200 * 1024;
const ALLOWED_MIME_SET = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp'
]);

const uploadDir = path.join(__dirname, '..', '..', 'data', 'uploads', 'images');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (_req, _file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
        cb(null, `${req.file?.fieldname || file.fieldname}-${uniqueSuffix}${ext}`);
    }
});

function marketFileFilter(_req, file, cb) {
    if (ALLOWED_MIME_SET.has(file.mimetype)) {
        cb(null, true);
        return;
    }
    const err = new Error('不支持的文件格式，仅支持 jpg/jpeg/png/webp');
    err.code = 'UNSUPPORTED_FILE_TYPE';
    cb(err, false);
}

const marketUploader = multer({
    storage,
    fileFilter: marketFileFilter,
    limits: { fileSize: UPLOAD_MAX_BYTES }
});

const applicationUploader = multer({
    storage,
    fileFilter: marketFileFilter,
    limits: { fileSize: APPLICATION_MAX_BYTES }
});

function withUploadHeader(res, maxBytes) {
    res.set('X-Upload-Max-Bytes', String(maxBytes != null ? maxBytes : UPLOAD_MAX_BYTES));
}

function imageLabelFromReq(req) {
    const raw = req && req.body && (req.body.image_label || req.body.imageLabel);
    return raw ? String(raw).trim().slice(0, 80) : '';
}

function mapUploadError(err, res, req, maxBytes) {
    withUploadHeader(res, maxBytes);
    const label = imageLabelFromReq(req);
    const prefix = label ? `「${label}」` : '';
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            const maxMb = ((maxBytes != null ? maxBytes : UPLOAD_MAX_BYTES) / 1024 / 1024).toFixed(maxBytes <= APPLICATION_MAX_BYTES ? 0 : 0);
            const limitText = maxBytes <= APPLICATION_MAX_BYTES
                ? `${Math.round((maxBytes || APPLICATION_MAX_BYTES) / 1024)}KB`
                : `${maxMb}MB`;
            return res.status(413).json({
                code: 40013,
                msg: `${prefix}图片过大，单张最大允许 ${limitText}，请压缩或换一张`,
                errmsg: `${prefix}图片过大，单张最大允许 ${limitText}，请压缩或换一张`,
                data: { max_bytes: maxBytes != null ? maxBytes : UPLOAD_MAX_BYTES, image_label: label || null }
            });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                code: 40015,
                msg: label ? `${prefix}缺少上传文件` : '缺少上传文件',
                data: null
            });
        }
    }

    if (err && err.code === 'UNSUPPORTED_FILE_TYPE') {
        return res.status(400).json({
            code: 40014,
            msg: `${prefix}格式不支持，仅支持 jpg/jpeg/png/webp`,
            errmsg: `${prefix}格式不支持，仅支持 jpg/jpeg/png/webp`,
            data: { image_label: label || null }
        });
    }

    return res.status(500).json({
        code: 50021,
        msg: '上传失败，请稍后重试',
        data: null
    });
}

function makeUploadHandler(uploader, maxBytes) {
    return function uploadMiddleware(req, res, next) {
        uploader.single('file')(req, res, (err) => {
            if (err) return mapUploadError(err, res, req, maxBytes);
            withUploadHeader(res, maxBytes);
            if (!req.file) {
                const label = imageLabelFromReq(req);
                const prefix = label ? `「${label}」` : '';
                return res.status(400).json({
                    code: 40015,
                    msg: `${prefix}缺少上传文件`,
                    data: null
                });
            }
            return next();
        });
    };
}

const uploadMarketImage = makeUploadHandler(marketUploader, UPLOAD_MAX_BYTES);
const uploadApplicationImage = makeUploadHandler(applicationUploader, APPLICATION_MAX_BYTES);

function getImageMeta(filePath) {
    try {
        const meta = imageSize(filePath);
        return {
            width: meta?.width || null,
            height: meta?.height || null
        };
    } catch (_) {
        return { width: null, height: null };
    }
}

module.exports = {
    uploadMarketImage,
    uploadApplicationImage,
    UPLOAD_MAX_BYTES,
    APPLICATION_MAX_BYTES,
    getImageMeta
};
