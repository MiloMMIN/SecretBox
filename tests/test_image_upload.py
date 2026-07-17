"""
Tests for image upload and serving functionality.

This module tests the image upload endpoint and verifies that image URLs
are correctly generated and accessible.
"""

import pytest
import os
import sys
import io
from unittest.mock import patch, MagicMock, PropertyMock

# Add server directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def app_instance():
    """Create app instance with mocked database."""
    # Mock the database before importing app
    with patch('app.SQLAlchemy') as mock_sqlalchemy:
        mock_db = MagicMock()
        mock_db.init_app = MagicMock()
        mock_db.create_all = MagicMock()
        mock_db.drop_all = MagicMock()
        mock_db.session = MagicMock()
        mock_sqlalchemy.return_value = mock_db

        from app import app
        app.config['TESTING'] = True
        app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), 'test_uploads')
        app.config['WX_APP_ID'] = 'test_app_id'
        app.config['WX_APP_SECRET'] = 'test_app_secret'

        # Ensure upload folder exists
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

        yield app

        # Clean up test uploads
        import shutil
        if os.path.exists(app.config['UPLOAD_FOLDER']):
            shutil.rmtree(app.config['UPLOAD_FOLDER'], ignore_errors=True)


@pytest.fixture
def client(app_instance):
    """Create test client."""
    return app_instance.test_client()


@pytest.fixture
def mock_wechat_auth():
    """Mock WeChat authentication for testing."""
    with patch('app.get_authenticated_user') as mock_get_user:
        # Create a mock user
        mock_user = MagicMock()
        mock_user.openid = 'test_openid'
        mock_user.role = 'student'
        mock_user.nickname = 'Test User'
        mock_user.avatar_url = ''
        mock_get_user.return_value = mock_user
        yield mock_get_user


class TestImageUpload:
    """Tests for image upload functionality."""

    def test_upload_image_requires_auth(self, client):
        """Test that image upload requires authentication."""
        response = client.post('/api/uploads/image')
        assert response.status_code == 401
        data = response.get_json()
        assert 'error' in data

    def test_upload_image_missing_file(self, client, mock_wechat_auth):
        """Test that upload fails when no file is provided."""
        response = client.post('/api/uploads/image')
        assert response.status_code == 400
        data = response.get_json()
        assert data['error'] == 'Missing file'

    def test_upload_image_unsupported_type(self, client, mock_wechat_auth):
        """Test that upload fails for unsupported file types."""
        # Create a test file with unsupported extension
        data = {
            'file': (MagicMock(), 'test.txt', 'text/plain')
        }
        response = client.post('/api/uploads/image', data=data)
        assert response.status_code == 400
        data = response.get_json()
        assert 'Unsupported file type' in data['error']

    def test_upload_image_success(self, client, mock_wechat_auth, tmp_path):
        """Test successful image upload."""
        # Temporarily change upload folder to tmp_path
        original_folder = client.application.config['UPLOAD_FOLDER']
        client.application.config['UPLOAD_FOLDER'] = str(tmp_path)

        try:
            # Create a test image file using BytesIO
            test_file_content = b'\x89PNG\r\n\x1a\n' + b'test image data'
            data = {
                'file': (io.BytesIO(test_file_content), 'test.png')
            }

            with client.application.test_request_context():
                response = client.post('/api/uploads/image', data=data, content_type='multipart/form-data')

            assert response.status_code == 200
            data = response.get_json()
            assert data['success'] is True
            assert 'url' in data
            assert '/uploads/' in data['url']
        finally:
            client.application.config['UPLOAD_FOLDER'] = original_folder

    def test_upload_image_avatar_size_limit(self, client, mock_wechat_auth, tmp_path):
        """Test that avatar uploads are limited to 512KB."""
        original_folder = client.application.config['UPLOAD_FOLDER']
        client.application.config['UPLOAD_FOLDER'] = str(tmp_path)

        try:
            # Create a file larger than 512KB
            large_content = b'\x89PNG\r\n\x1a\n' + b'x' * (512 * 1024 + 1)
            data = {
                'file': (io.BytesIO(large_content), 'large.png')
            }

            with client.application.test_request_context():
                response = client.post('/api/uploads/image?purpose=avatar', data=data, content_type='multipart/form-data')

            assert response.status_code == 400
            data = response.get_json()
            assert '512KB' in data['error']
        finally:
            client.application.config['UPLOAD_FOLDER'] = original_folder


class TestImageServing:
    """Tests for image serving functionality."""

    def test_serve_uploaded_image(self, client, mock_wechat_auth, tmp_path):
        """Test that uploaded images can be served."""
        original_folder = client.application.config['UPLOAD_FOLDER']
        client.application.config['UPLOAD_FOLDER'] = str(tmp_path)

        try:
            # First upload an image
            test_file_content = b'\x89PNG\r\n\x1a\n' + b'test image data'
            upload_data = {
                'file': (io.BytesIO(test_file_content), 'test.png')
            }

            with client.application.test_request_context():
                upload_response = client.post('/api/uploads/image', data=upload_data, content_type='multipart/form-data')

            assert upload_response.status_code == 200
            upload_data_result = upload_response.get_json()

            # Extract filename from URL
            filename = upload_data_result['url'].split('/uploads/')[-1]

            # Now try to serve the image
            serve_response = client.get(f'/uploads/{filename}')
            assert serve_response.status_code == 200
            assert serve_response.data == test_file_content
        finally:
            client.application.config['UPLOAD_FOLDER'] = original_folder

    def test_serve_nonexistent_image_returns_404(self, client):
        """Test that serving non-existent image returns 404."""
        response = client.get('/uploads/nonexistent.png')
        assert response.status_code == 404

    def test_serve_uploaded_image_has_cors_headers(self, client, mock_wechat_auth, tmp_path):
        """Test that served images include CORS headers for WeChat."""
        original_folder = client.application.config['UPLOAD_FOLDER']
        client.application.config['UPLOAD_FOLDER'] = str(tmp_path)

        try:
            # Upload an image
            test_file_content = b'\x89PNG\r\n\x1a\n' + b'test image data'
            upload_data = {
                'file': (io.BytesIO(test_file_content), 'test.png')
            }

            with client.application.test_request_context():
                upload_response = client.post('/api/uploads/image', data=upload_data, content_type='multipart/form-data')

            upload_data_result = upload_response.get_json()
            filename = upload_data_result['url'].split('/uploads/')[-1]

            # Serve the image and check CORS headers
            serve_response = client.get(f'/uploads/{filename}')
            assert serve_response.status_code == 200
            assert serve_response.headers.get('Access-Control-Allow-Origin') == '*'
            assert serve_response.headers.get('Access-Control-Allow-Methods') == 'GET, OPTIONS'
        finally:
            client.application.config['UPLOAD_FOLDER'] = original_folder


class TestBuildFileUrl:
    """Tests for build_file_url helper function."""

    def test_build_file_url_format(self, app_instance):
        """Test that build_file_url generates correct URL format."""
        with app_instance.test_request_context('/'):
            from app import build_file_url
            url = build_file_url('test123.png')
            # The URL should be absolute and point to /uploads/
            assert url.endswith('/uploads/test123.png')
            assert url.startswith('http://')

    def test_build_file_url_preserves_filename(self, app_instance):
        """Test that build_file_url preserves the filename."""
        with app_instance.test_request_context('/'):
            from app import build_file_url
            filename = 'abc-123_def456.png'
            url = build_file_url(filename)
            assert filename in url

    def test_build_file_url_uses_external_url_when_configured(self, app_instance):
        """Test that build_file_url uses EXTERNAL_URL when configured."""
        # Configure external URL
        app_instance.config['EXTERNAL_URL'] = 'https://mouow.asia'

        with app_instance.test_request_context('/'):
            from app import build_file_url
            url = build_file_url('test.png')
            # Should use the external URL, not the request host_url
            assert url.startswith('https://mouow.asia/uploads/')
            assert url.endswith('/uploads/test.png')

        # Clean up
        del app_instance.config['EXTERNAL_URL']

    def test_build_file_url_fallback_to_host_url(self, app_instance):
        """Test that build_file_url falls back to host_url when EXTERNAL_URL not configured."""
        with app_instance.test_request_context('/', base_url='http://localhost:5000'):
            from app import build_file_url
            url = build_file_url('test.png')
            # Should fall back to request.host_url
            assert url.startswith('http://localhost:5000/uploads/')

    def test_build_file_url_https_external_url(self, app_instance):
        """Test that build_file_url correctly handles HTTPS external URLs."""
        app_instance.config['EXTERNAL_URL'] = 'https://mouow.asia'

        with app_instance.test_request_context('/'):
            from app import build_file_url
            url = build_file_url('secure-image.png')
            assert url.startswith('https://mouow.asia/uploads/')
            assert 'secure-image.png' in url

        del app_instance.config['EXTERNAL_URL']

    def test_build_file_url_external_url_with_trailing_slash(self, app_instance):
        """Test that build_file_url handles trailing slashes correctly."""
        # Test with trailing slash
        app_instance.config['EXTERNAL_URL'] = 'https://mouow.asia/'

        with app_instance.test_request_context('/'):
            from app import build_file_url
            url = build_file_url('test.png')
            # Should not have double slashes
            assert url == 'https://mouow.asia/uploads/test.png'
            assert '//' not in url.replace('https://', '')

        del app_instance.config['EXTERNAL_URL']


class TestImageSecurity:
    """Tests for image security and validation."""

    def test_allowed_extensions(self, client, mock_wechat_auth, tmp_path):
        """Test that only allowed extensions are accepted."""
        original_folder = client.application.config['UPLOAD_FOLDER']
        client.application.config['UPLOAD_FOLDER'] = str(tmp_path)

        allowed_extensions = [
            ('test.jpg', 'image/jpeg'),
            ('test.jpeg', 'image/jpeg'),
            ('test.png', 'image/png'),
            ('test.gif', 'image/gif'),
            ('test.webp', 'image/webp'),
        ]

        disallowed_extensions = [
            ('test.txt', 'text/plain'),
            ('test.pdf', 'application/pdf'),
            ('test.exe', 'application/octet-stream'),
            ('test.bat', 'application/x-msdownload'),
        ]

        try:
            for filename, content_type in allowed_extensions:
                data = {'file': (io.BytesIO(b'fake image data'), filename)}
                with client.application.test_request_context():
                    response = client.post('/api/uploads/image', data=data, content_type='multipart/form-data')
                # Should succeed or fail for other reasons (not extension)
                assert response.status_code in [200, 400]
                if response.status_code == 400:
                    assert 'Unsupported file type' not in response.get_json()['error']

            for filename, content_type in disallowed_extensions:
                data = {'file': (io.BytesIO(b'fake data'), filename)}
                with client.application.test_request_context():
                    response = client.post('/api/uploads/image', data=data, content_type='multipart/form-data')
                assert response.status_code == 400
                assert 'Unsupported file type' in response.get_json()['error']
        finally:
            client.application.config['UPLOAD_FOLDER'] = original_folder
