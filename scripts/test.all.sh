#!/usr/bin/env bash
# One-click script to set up and run all tests
# Usage: ./scripts/test-all.sh [--skip-deps] [--skip-build] [--skip-e2e]

set -e  # Exit on error

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
SKIP_DEPS=false
SKIP_BUILD=false
SKIP_E2E=false

for arg in "$@"; do
    case $arg in
        --skip-deps)
            SKIP_DEPS=true
            shift
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --skip-e2e)
            SKIP_E2E=true
            shift
            ;;
        --help)
            echo "Usage: ./scripts/test-all.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --skip-deps    Skip npm install"
            echo "  --skip-build   Skip building the application"
            echo "  --skip-e2e     Skip E2E tests"
            echo "  --help         Show this help message"
            exit 0
            ;;
    esac
done

echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Surveyor - Complete Test Suite Setup          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
echo ""

# Step 1: Check dependencies
if [ "$SKIP_DEPS" = false ]; then
    echo -e "${YELLOW}[1/9]${NC} Installing dependencies..."
    npm ci --silent
    echo -e "${GREEN}✓${NC} Dependencies installed"
    echo ""
else
    echo -e "${YELLOW}[1/9]${NC} Skipping dependency installation"
    echo ""
fi

# Step 2: Check for Docker
echo -e "${YELLOW}[2/9]${NC} Checking for Docker..."
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗${NC} Docker is not installed. Please install Docker first."
    exit 1
fi
echo -e "${GREEN}✓${NC} Docker is available"
echo ""

# Step 3: Start MariaDB test container
echo -e "${YELLOW}[3/9]${NC} Starting MariaDB test container..."
docker compose -f docker-compose.mariadb.test.yml up -d
echo ""

# Wait for MariaDB to be ready
echo -e "${YELLOW}[3/9]${NC} Waiting for MariaDB to be ready..."
for i in {1..30}; do
    if mysqladmin ping -h 127.0.0.1 -uroot -proot --silent 2>/dev/null; then
        echo -e "${GREEN}✓${NC} MariaDB is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}✗${NC} MariaDB failed to start in time"
        exit 1
    fi
    sleep 2
done
echo ""

# Step 4: Configure MariaDB
echo -e "${YELLOW}[4/9]${NC} Configuring MariaDB..."
mysql -h 127.0.0.1 -uroot -proot -e "SET GLOBAL sql_mode='';" 2>/dev/null
mysql -h 127.0.0.1 -uroot -proot -e "CREATE DATABASE IF NOT EXISTS surveyor_e2e;" 2>/dev/null
mysql -h 127.0.0.1 -uroot -proot -e "GRANT ALL ON surveyor_e2e.* TO 'surveyor'@'%';" 2>/dev/null
mysql -h 127.0.0.1 -uroot -proot -e "FLUSH PRIVILEGES;" 2>/dev/null
echo -e "${GREEN}✓${NC} MariaDB configured"
echo ""

# Step 5: Create test environment files
echo -e "${YELLOW}[5/9]${NC} Creating test environment files..."
mkdir -p tests

# Copy from example files
if [ -f "tests/.env.test.example" ]; then
    cp tests/.env.test.example tests/.env.test
else
    echo -e "${RED}✗${NC} tests/.env.test.example not found"
    exit 1
fi

if [ -f ".env.e2e.example" ]; then
    cp .env.e2e.example .env.e2e
else
    echo -e "${RED}✗${NC} .env.e2e.example not found"
    exit 1
fi

echo -e "${GREEN}✓${NC} Environment files created from examples"
echo ""

# Step 6: Build application
if [ "$SKIP_BUILD" = false ]; then
    echo -e "${YELLOW}[6/9]${NC} Building application..."
    npm run build > /dev/null 2>&1
    echo -e "${GREEN}✓${NC} Application built"
    echo ""
else
    echo -e "${YELLOW}[6/9]${NC} Skipping build"
    echo ""
fi

# Step 7: Run Jest tests
echo -e "${YELLOW}[7/9]${NC} Running Jest tests (unit, controller, middleware, database)..."
echo ""
npm test
JEST_EXIT=$?
echo ""
if [ $JEST_EXIT -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Jest tests passed"
else
    echo -e "${RED}✗${NC} Jest tests failed"
    echo -e "${YELLOW}Stopping MariaDB container...${NC}"
    docker compose -f docker-compose.mariadb.test.yml down
    exit $JEST_EXIT
fi
echo ""

# Step 8: Prepare E2E database
if [ "$SKIP_E2E" = false ]; then
    echo -e "${YELLOW}[8/9]${NC} Preparing E2E database..."
    npm run e2e:prepare
    echo -e "${GREEN}✓${NC} E2E database prepared"
    echo ""

    # Step 9: Run E2E tests
    echo -e "${YELLOW}[9/9]${NC} Running E2E tests..."
    echo ""
    
    # Check if Playwright browsers are installed
    if [ ! -d "$HOME/.cache/ms-playwright" ] || [ -z "$(ls -A $HOME/.cache/ms-playwright)" ]; then
        echo -e "${YELLOW}Installing Playwright browsers...${NC}"
        npx playwright install --with-deps chromium
        echo ""
    fi
    
    npm run e2e
    E2E_EXIT=$?
    echo ""
    if [ $E2E_EXIT -eq 0 ]; then
        echo -e "${GREEN}✓${NC} E2E tests passed"
    else
        echo -e "${RED}✗${NC} E2E tests failed"
        echo -e "${YELLOW}Stopping MariaDB container...${NC}"
        docker compose -f docker-compose.mariadb.test.yml down
        exit $E2E_EXIT
    fi
else
    echo -e "${YELLOW}[8/9]${NC} Skipping E2E database preparation"
    echo -e "${YELLOW}[9/9]${NC} Skipping E2E tests"
fi
echo ""

# Cleanup
echo -e "${YELLOW}Cleaning up...${NC}"
docker compose -f docker-compose.mariadb.test.yml down
echo ""

# Summary
echo -e "${GREEN}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           All tests passed successfully! 🎉         ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Test Summary:"
echo -e "  • Jest tests: ${GREEN}✓ Passed${NC}"
if [ "$SKIP_E2E" = false ]; then
    echo -e "  • E2E tests:  ${GREEN}✓ Passed${NC}"
else
    echo -e "  • E2E tests:  ${YELLOW}⊘ Skipped${NC}"
fi
echo ""
