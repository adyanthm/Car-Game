// Interface definition
// Define the enum
enum UserRole {
    Admin = "ADMIN",
    User = "USER",
    Guest = "GUEST"
}

// Update the interface
interface User {
    name: string;
    age: number;
    email?: string;
    role: UserRole;  // New required property
}

class UserManager {
    private users: User[] = [];

    public addUser(user: User): void {
        this.users.push(user);
    }

    public getUsers(): User[] {
        return this.users;
    }
}

const manager = new UserManager();

// Update the user objects to include the role property
manager.addUser({
    name: "John Doe",
    age: 30,
    email: "john@example.com",
    role: UserRole.Admin    // Add the role
});

manager.addUser({
    name: "Jane Smith",
    age: 25,
    role: UserRole.User     // Add the role (email is optional)
});

function displayUsers(users: User[]): void {
    users.forEach(user => {
        console.log(`Name: ${user.name}, Age: ${user.age}, Email: ${user.email || 'N/A'}, Role: ${user.role}`);
    });
}

displayUsers(manager.getUsers());

class DataStorage<T> {
    private data: T[] = [];

    addItem(item: T) {
        this.data.push(item);
    }

    getItems(): T[] {
        return [...this.data];
    }
}

// Use it like:
const textStorage = new DataStorage<string>();
textStorage.addItem("Hello");
textStorage.addItem("TypeScript"); 