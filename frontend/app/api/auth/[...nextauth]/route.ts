export const dynamic = "force-dynamic";

import NextAuth from "next-auth";
import { getAuthOptions } from "@/backend/auth/authOptions";

const handler = (req: any, res: any) => NextAuth(req, res, getAuthOptions());

export { handler as GET, handler as POST };
