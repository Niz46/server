# MilesHome Real Estate Application

A full-stack real estate management platform built with Next.js, Node.js (Express), PostgreSQL, and Prisma. This application allows managers to list properties, tenants to browse and apply, and both parties to communicate seamlessly via email notifications and live chat.

---

## 🚀 Features

* **Property Listings**: Create, update, and delete property listings with images uploaded to AWS S3.
* **Tenant Management**: Managers can view tenant profiles, approve or reject applications, and send targeted email notifications.
* **Authentication & Authorization**: User sign‑in via AWS Cognito; roles (`manager` vs `tenant`) drive access controls.
* **Email Notifications**: Transactional emails (new applications, status updates, announcements) powered by Mailgun or SparkPost.
* **Real‑Time Chat**: Integrated chat prompt for bank transfer payment support.
* **Dashboard**: Separate interfaces for managers and tenants with tailored views (property management vs current residences).
* **Payments & History**: Create and track payments; tenants can view billing history and receipts.

---

## 🛠 Tech Stack

* **Frontend**: Next.js, React, TypeScript, Tailwind CSS, ShadCN/UI, React Hook Form, Zod
* **Backend**: Node.js, Express, TypeScript, Prisma ORM, PostgreSQL
* **Authentication**: AWS Cognito
* **Storage**: AWS S3
* **Email Service**: Mailgun (or SparkPost) via `@mailgun-js` / `@sparkpost/node-client`
* **Dev Tools**: ESLint, Prettier, VSCode, Docker (optional)

---

## 📥 Quick Start

### Prerequisites

* Node.js (v16+)
* PostgreSQL database
* AWS account with S3 bucket & Cognito user pool
* Mailgun, SparkPost, or other transactional email service account

### 1. Clone the repo

```bash
git clone https://github.com/your-org/mileshome-realestate.git
cd mileshome-realestate
```

### 2. Install dependencies

```bash
# Install server dependencies
npm install --prefix server

# Install client dependencies
npm install --prefix client
```

### 3. Configure environment variables

#### Server (.env in /server)

```dotenv
PORT=3001
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/db?schema=public"

# AWS
S3_BUCKET_NAME=arn:aws:s3:::<your-bucket>
AWS_REGION=<your-region>
COGNITO_USER_POOL_ID=<your-user-pool-id>
COGNITO_CLIENT_ID=<your-client-id>

# Email (choose one)
# Mailgun
MAILGUN_API_KEY=<mailgun-api-key>
MAILGUN_DOMAIN=<mailgun-domain>
MAILGUN_SENDER_EMAIL=no-reply@yourdomain.com
MAILGUN_SENDER_NAME="MilesHome Real Estate"

# or SparkPost
SPARKPOST_API_KEY=<sparkpost-api-key>
SPARKPOST_SENDER_EMAIL=no-reply@yourdomain.com
SPARKPOST_SENDER_NAME="MilesHome Real Estate"
```

#### Client (.env.local in /client)

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
NEXT_PUBLIC_COGNITO_USER_POOL_ID=<your-user-pool-id>
NEXT_PUBLIC_COGNITO_CLIENT_ID=<your-client-id>
```

### 4. Development

Start both server and client in parallel:

```bash
# In one terminal, run the backend
npm run dev --prefix server

# In another terminal, run the frontend
npm run dev --prefix client
```

Open your browser at `http://localhost:3000` to view the app.

---

## 📐 API Endpoints

### Authentication & Users

* `GET /api/auth/user` — fetch current user profile

### Properties

* `GET /api/properties` — list properties
* `GET /api/properties/:id` — property details
* `POST /api/properties` — create a property *(manager only)*
* `PUT /api/properties/:id` — update a property *(manager only)*

### Tenants & Applications

* `GET /api/tenants/:cognitoId` — tenant profile
* `GET /api/applications` — list applications
* `POST /api/applications` — create a new application
* `PUT /api/applications/:id/status` — update application status *(manager only)*

### Payments

* `POST /api/payments` — create payment record
* `GET /api/payments/tenant/:cognitoId` — tenant payment history

### Notifications

* `POST /api/notifications/email/all` — blast email to all tenants *(manager only)*
* `POST /api/notifications/email/user` — email single tenant *(manager only)*

---

## 🤝 Contributing

1. Fork this repo. 2. Create a feature branch (`git checkout -b feature/YourFeature`). 3. Commit your changes. 4. Open a Pull Request.

---

## 📄 License

MIT © \[Favour Nzeh]
